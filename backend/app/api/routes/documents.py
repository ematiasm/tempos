import uuid
from datetime import date
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlalchemy.orm import selectinload
from sqlmodel import col, func, select

from app import crud
from app.api.deps import CurrentUser, PaginationDep, SessionDep, require_permissions
from app.core.config import settings
from app.models import (
    BusinessSettings,
    CounterpartType,
    Customer,
    Document,
    DocumentAllocationPublic,
    DocumentCreate,
    DocumentEmailCreate,
    DocumentEmailStatus,
    DocumentLine,
    DocumentNotesUpdate,
    DocumentOperation,
    DocumentPaymentAllocation,
    DocumentPublic,
    DocumentStatus,
    DocumentTypePublic,
    DocumentVoidCreate,
    Page,
    PaymentMethod,
    Product,
    Supplier,
    User,
    UserPublic,
)
from app.utils import render_email_template, send_email

router = APIRouter(prefix="/documents", tags=["documents"])


def _document_query_options() -> tuple[Any, ...]:
    return (
        selectinload(Document.document_type),  # type: ignore
        selectinload(Document.lines).selectinload(DocumentLine.taxes),  # type: ignore
        selectinload(Document.taxes),  # type: ignore
        selectinload(Document.payments),  # type: ignore
    )


def _attach_counterpart_names(
    session: SessionDep, documents: list[Document]
) -> list[DocumentPublic]:
    """Resolve the polymorphic counterpart name with two bulk queries."""
    customer_ids = {
        d.contraparte_id
        for d in documents
        if d.contraparte_type == CounterpartType.CUSTOMER and d.contraparte_id
    }
    supplier_ids = {
        d.contraparte_id
        for d in documents
        if d.contraparte_type == CounterpartType.SUPPLIER and d.contraparte_id
    }
    names: dict[uuid.UUID, str] = {}
    emails: dict[uuid.UUID, str | None] = {}
    if customer_ids:
        customers = session.exec(
            select(Customer).where(col(Customer.id).in_(customer_ids))
        ).all()
        names.update({c.id: c.razon_social for c in customers})
        emails.update({c.id: c.email for c in customers})
    if supplier_ids:
        suppliers = session.exec(
            select(Supplier).where(col(Supplier.id).in_(supplier_ids))
        ).all()
        names.update({s.id: s.razon_social for s in suppliers})
        emails.update({s.id: s.email for s in suppliers})
    # Active children (for quotes: the invoice they were converted into).
    parent_ids = [d.id for d in documents]
    children = (
        session.exec(
            select(Document.parent_document_id, Document.id, Document.numero)
            .where(col(Document.parent_document_id).in_(parent_ids))
            .where(Document.estado == DocumentStatus.ACTIVE)
        ).all()
        if parent_ids
        else []
    )
    child_map = {parent: (child_id, numero) for parent, child_id, numero in children}

    publics = []
    for document in documents:
        public = DocumentPublic.model_validate(document)
        public.contraparte_name = (
            names.get(document.contraparte_id) if document.contraparte_id else None
        )
        public.contraparte_email = (
            emails.get(document.contraparte_id) if document.contraparte_id else None
        )
        child = child_map.get(document.id)
        if child:
            public.child_document_id, public.child_document_numero = child
        publics.append(public)
    _attach_line_product_names(session, publics)
    return publics


def _attach_line_product_names(
    session: SessionDep, publics: list[DocumentPublic]
) -> None:
    """Resolve line product names with a single bulk query (in place)."""
    product_ids = {line.product_id for public in publics for line in public.lines}
    if not product_ids:
        return
    names = dict(
        session.exec(
            select(Product.id, Product.name).where(col(Product.id).in_(product_ids))
        ).all()
    )
    for public in publics:
        for line in public.lines:
            line.product_name = names.get(line.product_id)


@router.get(
    "/suggest-type",
    response_model=DocumentTypePublic,
    dependencies=[require_permissions("document.read")],
)
def suggest_fiscal_sale_type(session: SessionDep, customer_id: uuid.UUID) -> Any:
    """Resolve Factura A/B/C from the business/customer tax condition combo."""
    try:
        return crud.suggest_fiscal_sale_type(session=session, customer_id=customer_id)
    except crud.BusinessError as e:
        raise HTTPException(
            status_code=400, detail={"code": e.code, "message": e.message}
        ) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get(
    "/creators",
    response_model=list[UserPublic],
    dependencies=[require_permissions("document.read")],
)
def read_document_creators(session: SessionDep) -> Any:
    """List the users who created at least one document (for filtering)."""
    users = session.exec(
        select(User)
        .join(Document, col(Document.user_id) == col(User.id))
        .distinct()
        .order_by(col(User.full_name), col(User.email))
    ).all()
    return users


@router.get(
    "/",
    response_model=Page[DocumentPublic],
    dependencies=[require_permissions("document.read")],
)
def read_documents(
    session: SessionDep,
    pagination: PaginationDep,
    document_type_id: uuid.UUID | None = None,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    user_id: uuid.UUID | None = None,
) -> Any:
    """Retrieve documents with lines, taxes and payments, optionally filtered
    by document type, a date range and creator.

    ``fecha_desde``/``fecha_hasta`` are inclusive business-local days resolved
    against ``Document.fecha``.
    """
    clauses = []
    if document_type_id is not None:
        clauses.append(col(Document.document_type_id) == document_type_id)
    dt_from, dt_to = crud.period_bounds(session, fecha_desde, fecha_hasta)
    if dt_from is not None:
        clauses.append(col(Document.fecha) >= dt_from)
    if dt_to is not None:
        clauses.append(col(Document.fecha) <= dt_to)
    if user_id is not None:
        clauses.append(col(Document.user_id) == user_id)
    count = session.exec(
        select(func.count()).select_from(Document).where(*clauses)
    ).one()
    documents = session.exec(
        select(Document)
        .options(*_document_query_options())
        .where(*clauses)
        .order_by(col(Document.created_at).desc())
        .offset(pagination.skip)
        .limit(pagination.limit)
    ).all()
    return Page[DocumentPublic](
        data=_attach_counterpart_names(session, list(documents)), count=count
    )


@router.get(
    "/email-status",
    response_model=DocumentEmailStatus,
    dependencies=[require_permissions("document.email")],
)
def read_email_status() -> Any:
    """Whether outbound email delivery is configured (fail-closed).

    Guarded by ``document.email`` (not ``settings.read``) so it matches
    exactly who sees the email action on the sell screen.
    """
    try:
        enabled = bool(settings.emails_enabled)
    except Exception:
        enabled = False
    return DocumentEmailStatus(emails_enabled=enabled)


@router.get(
    "/{document_id}",
    response_model=DocumentPublic,
    dependencies=[require_permissions("document.read")],
)
def read_document(session: SessionDep, document_id: uuid.UUID) -> Any:
    """Get a specific document by id."""
    document = session.exec(
        select(Document)
        .where(col(Document.id) == document_id)
        .options(*_document_query_options())
    ).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    public = _attach_counterpart_names(session, [document])[0]
    _attach_line_product_names(session, [public])
    voided = crud.get_line_voided_quantities(session=session, document=document)
    for line in public.lines:
        original_qty = next(x.cantidad for x in document.lines if x.id == line.id)
        line.cantidad_pendiente = original_qty - voided.get(line.id, Decimal("0"))
    return public


@router.get(
    "/{document_id}/allocations",
    response_model=list[DocumentAllocationPublic],
    dependencies=[require_permissions("document.read")],
)
def read_document_allocations(session: SessionDep, document_id: uuid.UUID) -> Any:
    """Receipts imputed to a document (incoming allocations)."""
    document = session.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    rows = session.exec(
        select(DocumentPaymentAllocation, Document)
        .join(
            Document,
            col(Document.id) == col(DocumentPaymentAllocation.receipt_document_id),
        )
        .where(
            col(DocumentPaymentAllocation.document_id) == document_id,
            col(Document.estado) == DocumentStatus.ACTIVE,
        )
        .order_by(col(Document.fecha).asc(), col(Document.numero).asc())
    ).all()
    return [
        DocumentAllocationPublic(
            receipt_document_id=receipt.id,
            receipt_numero=receipt.numero,
            fecha=receipt.fecha,
            monto=allocation.monto,
            saldo_inicial=allocation.saldo_inicial,
        )
        for allocation, receipt in rows
    ]


@router.post(
    "/",
    response_model=DocumentPublic,
    dependencies=[require_permissions("document.create")],
)
def create_document(
    *, session: SessionDep, current_user: CurrentUser, document_in: DocumentCreate
) -> Any:
    """Create a document with its lines, taxes and payments."""
    try:
        document, cost_suggestions, stock_warnings = crud.create_document(
            session=session, document_in=document_in, user_id=current_user.id
        )
    except crud.BusinessError as e:
        session.rollback()
        raise HTTPException(
            status_code=400, detail={"code": e.code, "message": e.message}
        ) from e
    except ValueError as e:
        session.rollback()
        raise HTTPException(status_code=400, detail=str(e)) from e
    public = _attach_counterpart_names(session, [document])[0]
    _attach_line_product_names(session, [public])
    public.cost_change_suggestions = cost_suggestions
    public.stock_warnings = stock_warnings
    return public


@router.patch(
    "/{document_id}/notes",
    response_model=DocumentPublic,
    dependencies=[require_permissions("document.create")],
)
def update_document_notes(
    *,
    session: SessionDep,
    document_id: uuid.UUID,
    notes_in: DocumentNotesUpdate,
) -> Any:
    """Set or clear the printable note of an ACTIVE document."""
    document = session.get(Document, document_id)
    if not document:
        raise HTTPException(
            status_code=404,
            detail={"code": "document_not_found", "message": "Document not found"},
        )
    try:
        document = crud.update_document_notes(
            session=session, document=document, notes=notes_in.notes
        )
    except crud.BusinessError as e:
        session.rollback()
        raise HTTPException(
            status_code=400, detail={"code": e.code, "message": e.message}
        ) from e
    public = _attach_counterpart_names(session, [document])[0]
    _attach_line_product_names(session, [public])
    return public


def _counterpart_display_name(session: SessionDep, document: Document) -> str | None:
    """Resolve the counterpart display name for a single document."""
    if not document.contraparte_id:
        return None
    counterpart: Customer | Supplier | None = None
    if document.contraparte_type == CounterpartType.CUSTOMER:
        counterpart = session.get(Customer, document.contraparte_id)
    elif document.contraparte_type == CounterpartType.SUPPLIER:
        counterpart = session.get(Supplier, document.contraparte_id)
    return counterpart.razon_social if counterpart else None


def _document_email_context(session: SessionDep, document: Document) -> dict[str, Any]:
    """Build the voucher-email template context (read-only; no DB write)."""
    bs = session.exec(select(BusinessSettings)).first()
    product_ids = {line.product_id for line in document.lines}
    product_names = (
        dict(
            session.exec(
                select(Product.id, Product.name).where(col(Product.id).in_(product_ids))
            ).all()
        )
        if product_ids
        else {}
    )
    method_ids = {p.payment_method_id for p in document.payments}
    method_names = (
        dict(
            session.exec(
                select(PaymentMethod.id, PaymentMethod.name).where(
                    col(PaymentMethod.id).in_(method_ids)
                )
            ).all()
        )
        if method_ids
        else {}
    )
    # Methods that do not mark as paid (credit/current-account) never move
    # money: their rows are not payments, so they stay out of the voucher.
    marks_paid = dict(
        session.exec(select(PaymentMethod.id, PaymentMethod.marks_paid)).all()
    )
    paid_payments = [
        p for p in document.payments if marks_paid.get(p.payment_method_id, True)
    ]
    doc_operation = document.document_type.operation if document.document_type else None
    # Receipts applied to this sale/purchase after its issue (active ones
    # only), so the emailed voucher reflects the current payment state.
    receipt_allocations: list[dict[str, Any]] = []
    saldo_pendiente: str | None = None
    incoming_paid = Decimal("0")
    paid_at_issue = sum(p.monto for p in paid_payments)
    if doc_operation in (DocumentOperation.VENTA, DocumentOperation.COMPRA):
        rows = session.exec(
            select(DocumentPaymentAllocation, Document)
            .join(
                Document,
                col(Document.id) == col(DocumentPaymentAllocation.receipt_document_id),
            )
            .where(
                col(DocumentPaymentAllocation.document_id) == document.id,
                col(Document.estado) == DocumentStatus.ACTIVE,
            )
            .order_by(col(Document.fecha).asc(), col(Document.numero).asc())
        ).all()
        for allocation, receipt in rows:
            incoming_paid += allocation.monto
            initial = allocation.saldo_inicial
            receipt_allocations.append(
                {
                    "numero": receipt.numero,
                    "fecha": receipt.fecha.strftime("%Y-%m-%d %H:%M"),
                    "monto": str(allocation.monto),
                    "saldo_inicial": str(initial) if initial is not None else None,
                    "saldo_restante": str(initial - allocation.monto)
                    if initial is not None
                    else None,
                }
            )
        pending = document.total - document.favor_monto - paid_at_issue - incoming_paid
        if pending > 0:
            saldo_pendiente = str(pending)
    return {
        "business_name": bs.business_name if bs else "",
        "business_address": bs.address if bs else None,
        "business_phone": bs.phone if bs else None,
        "business_cuit": bs.cuit if bs else None,
        "numero": document.numero,
        "fecha": document.fecha.strftime("%Y-%m-%d %H:%M"),
        "customer_name": _counterpart_display_name(session, document),
        "lines": [
            {
                "name": product_names.get(line.product_id),
                "cantidad": str(line.cantidad),
                "precio_unit": str(line.precio_unit),
                "subtotal_line": str(line.subtotal_line),
            }
            for line in sorted(document.lines, key=lambda x: x.orden)
        ],
        "subtotal": str(document.subtotal),
        "descuento_total": str(document.descuento_total),
        "total": str(document.total),
        "payments": [
            {
                "method_name": method_names.get(p.payment_method_id),
                "monto": str(p.monto),
            }
            for p in paid_payments
        ],
        "notes": document.notes,
        "receipt_allocations": receipt_allocations,
        "saldo_pendiente": saldo_pendiente,
        "voucher_footer": bs.voucher_footer if bs else None,
        "voucher_legends": (
            bs.voucher_legends.splitlines() if bs and bs.voucher_legends else []
        ),
    }


@router.post(
    "/{document_id}/email",
    status_code=204,
    dependencies=[require_permissions("document.email")],
)
def email_document(
    *, session: SessionDep, document_id: uuid.UUID, email_in: DocumentEmailCreate
) -> None:
    """Email the document voucher to the counterpart (or an explicit address).

    Read-only on the database: the document is never modified, so an SMTP
    failure degrades to a business error with nothing to roll back.
    """
    document = session.exec(
        select(Document)
        .where(col(Document.id) == document_id)
        .options(*_document_query_options())
    ).first()
    if not document:
        raise HTTPException(
            status_code=404,
            detail={"code": "document_not_found", "message": "Document not found"},
        )
    if not settings.emails_enabled:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "email_not_enabled",
                "message": "Outbound email is not configured",
            },
        )
    email_to = email_in.email_to
    if not email_to and document.contraparte_id:
        counterpart: Customer | Supplier | None = None
        if document.contraparte_type == CounterpartType.CUSTOMER:
            counterpart = session.get(Customer, document.contraparte_id)
        elif document.contraparte_type == CounterpartType.SUPPLIER:
            counterpart = session.get(Supplier, document.contraparte_id)
        email_to = counterpart.email if counterpart else None
    if not email_to:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "document_email_missing_address",
                "message": "No email address is available for this document",
            },
        )
    context = _document_email_context(session, document)
    try:
        html_content = render_email_template(
            template_name="document_voucher.html", context=context
        )
        send_email(
            email_to=email_to,
            subject=f"{context['business_name']} - Voucher {document.numero}",
            html_content=html_content,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "document_email_failed",
                "message": "The voucher email could not be sent",
            },
        ) from e


@router.post(
    "/{document_id}/void",
    response_model=DocumentPublic,
    dependencies=[require_permissions("document.void")],
)
def void_document(
    *,
    session: SessionDep,
    document_id: uuid.UUID,
    void_in: DocumentVoidCreate,
    current_user: CurrentUser,
) -> Any:
    """Void a document totally (empty lines) or partially, issuing its NC."""
    try:
        nc = crud.void_document(
            session=session,
            document_id=document_id,
            void_in=void_in,
            user_id=current_user.id,
        )
    except crud.BusinessError as e:
        session.rollback()
        raise HTTPException(
            status_code=400, detail={"code": e.code, "message": e.message}
        ) from e
    except ValueError as e:
        session.rollback()
        raise HTTPException(status_code=400, detail=str(e)) from e
    public = _attach_counterpart_names(session, [nc])[0]
    _attach_line_product_names(session, [public])
    return public


@router.post(
    "/{document_id}/convert-to-invoice",
    response_model=DocumentPublic,
    dependencies=[require_permissions("document.create")],
)
def convert_to_invoice(
    *, session: SessionDep, document_id: uuid.UUID, current_user: CurrentUser
) -> Any:
    """Convert a quote into an invoice in one click (exact copy)."""
    try:
        invoice = crud.convert_quote_to_invoice(
            session=session, document_id=document_id, user_id=current_user.id
        )
    except crud.BusinessError as e:
        session.rollback()
        raise HTTPException(
            status_code=400, detail={"code": e.code, "message": e.message}
        ) from e
    except ValueError as e:
        session.rollback()
        raise HTTPException(status_code=400, detail=str(e)) from e
    public = _attach_counterpart_names(session, [invoice])[0]
    _attach_line_product_names(session, [public])
    return public
