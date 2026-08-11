import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlalchemy.orm import selectinload
from sqlmodel import col, func, select

from app import crud
from app.api.deps import CurrentUser, PaginationDep, SessionDep, require_permissions
from app.models import (
    CounterpartType,
    Customer,
    Document,
    DocumentAllocationPublic,
    DocumentCreate,
    DocumentLine,
    DocumentPaymentAllocation,
    DocumentPublic,
    DocumentStatus,
    DocumentTypePublic,
    DocumentVoidCreate,
    Page,
    Supplier,
    User,
    UserPublic,
)

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
    if customer_ids:
        names.update(
            {
                c.id: c.razon_social
                for c in session.exec(
                    select(Customer).where(col(Customer.id).in_(customer_ids))
                ).all()
            }
        )
    if supplier_ids:
        names.update(
            {
                s.id: s.razon_social
                for s in session.exec(
                    select(Supplier).where(col(Supplier.id).in_(supplier_ids))
                ).all()
            }
        )
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
        child = child_map.get(document.id)
        if child:
            public.child_document_id, public.child_document_numero = child
        publics.append(public)
    return publics


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
    fecha_desde: datetime | None = None,
    fecha_hasta: datetime | None = None,
    user_id: uuid.UUID | None = None,
) -> Any:
    """Retrieve documents with lines, taxes and payments, optionally filtered
    by document type, a date range (both bounds inclusive) and creator."""
    clauses = []
    if document_type_id is not None:
        clauses.append(col(Document.document_type_id) == document_type_id)
    if fecha_desde is not None:
        clauses.append(col(Document.fecha) >= fecha_desde)
    if fecha_hasta is not None:
        clauses.append(col(Document.fecha) <= fecha_hasta)
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
        document, cost_suggestions = crud.create_document(
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
    public.cost_change_suggestions = cost_suggestions
    return public


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
    return _attach_counterpart_names(session, [nc])[0]


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
    return _attach_counterpart_names(session, [invoice])[0]
