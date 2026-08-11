import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload
from sqlmodel import Session, col, delete, func, select

from app.core.security import get_password_hash, verify_password
from app.models import (
    FISCAL_SALE_TYPE_NAMES,
    AccountMovement,
    AccountMovementType,
    Attribute,
    AttributeCreate,
    AttributeValue,
    BusinessSettings,
    CostChangeSuggestion,
    CounterpartType,
    Customer,
    CustomerAccountMovement,
    Document,
    DocumentCreate,
    DocumentLine,
    DocumentLineCreate,
    DocumentLineTax,
    DocumentOperation,
    DocumentPayment,
    DocumentPaymentAllocation,
    DocumentPaymentCreate,
    DocumentSequence,
    DocumentStatus,
    DocumentTax,
    DocumentType,
    DocumentVoidCreate,
    FinancialAccount,
    Item,
    ItemCreate,
    PaymentMethod,
    PaymentReceiptCreate,
    Product,
    ProductCreate,
    ProductTax,
    ProductUpdate,
    ProductVariant,
    ProductVariantAttribute,
    Role,
    StockMovement,
    Supplier,
    SupplierAccountMovement,
    SupplierProduct,
    SupplierProductCreate,
    SupplierProductUpdate,
    TaxAppliesTo,
    TaxCondition,
    Transfer,
    TransferCreate,
    User,
    UserCreate,
    UserRole,
    UserUpdate,
)


def create_user(*, session: Session, user_create: UserCreate) -> User:
    db_obj = User.model_validate(
        user_create, update={"hashed_password": get_password_hash(user_create.password)}
    )
    session.add(db_obj)
    session.commit()
    session.refresh(db_obj)
    _sync_user_roles(session, db_obj, user_create.role_ids)
    session.refresh(db_obj)
    return db_obj


def update_user(*, session: Session, db_user: User, user_in: UserUpdate) -> Any:
    user_data = user_in.model_dump(exclude_unset=True)
    extra_data = {}
    if "password" in user_data:
        password = user_data["password"]
        hashed_password = get_password_hash(password)
        extra_data["hashed_password"] = hashed_password
    db_user.sqlmodel_update(user_data, update=extra_data)
    session.add(db_user)
    session.commit()
    session.refresh(db_user)
    role_ids = user_data.pop("role_ids", None) if "role_ids" in user_data else None
    if role_ids is not None:
        _sync_user_roles(session, db_user, role_ids)
        session.refresh(db_user)
    return db_user


def get_user_by_email(*, session: Session, email: str) -> User | None:
    statement = select(User).where(User.email == email)
    session_user = session.exec(statement).first()
    return session_user


# Dummy hash to use for timing attack prevention when user is not found
# This is an Argon2 hash of a random password, used to ensure constant-time comparison
DUMMY_HASH = "$argon2id$v=19$m=65536,t=3,p=4$MjQyZWE1MzBjYjJlZTI0Yw$YTU4NGM5ZTZmYjE2NzZlZjY0ZWY3ZGRkY2U2OWFjNjk"


def authenticate(*, session: Session, email: str, password: str) -> User | None:
    db_user = get_user_by_email(session=session, email=email)
    if not db_user:
        # Prevent timing attacks by running password verification even when user doesn't exist
        # This ensures the response time is similar whether or not the email exists
        verify_password(password, DUMMY_HASH)
        return None
    verified, updated_password_hash = verify_password(password, db_user.hashed_password)
    if not verified:
        return None
    if updated_password_hash:
        db_user.hashed_password = updated_password_hash
        session.add(db_user)
        session.commit()
        session.refresh(db_user)
    return db_user


def create_item(*, session: Session, item_in: ItemCreate, owner_id: uuid.UUID) -> Item:
    db_item = Item.model_validate(item_in, update={"owner_id": owner_id})
    session.add(db_item)
    session.commit()
    session.refresh(db_item)
    return db_item


def _sync_user_roles(session: Session, user: User, role_ids: list[uuid.UUID]) -> None:
    """Replace all role assignments for ``user`` so that only ``role_ids`` remain."""
    session.exec(delete(UserRole).where(col(UserRole.user_id) == user.id))
    for rid in role_ids:
        role = session.get(Role, rid)
        if role:
            session.add(UserRole(user_id=user.id, role_id=rid))
    session.commit()


def _compute_precio_venta(costo_actual: Decimal, margen_pct: Decimal) -> Decimal:
    """precio_venta = costo_actual * (1 + margen_pct / 100), rounded to 2 decimals."""
    return (costo_actual * (Decimal("1") + margen_pct / Decimal("100"))).quantize(
        Decimal("0.01")
    )


def create_product(*, session: Session, product_in: ProductCreate) -> Product:
    precio_venta = _compute_precio_venta(product_in.costo_actual, product_in.margen_pct)
    db_obj = Product.model_validate(product_in, update={"precio_venta": precio_venta})
    session.add(db_obj)
    session.commit()
    session.refresh(db_obj)
    _sync_product_taxes(session, db_obj, product_in.tax_ids)
    session.refresh(db_obj)
    return db_obj


def update_product(
    *, session: Session, db_product: Product, product_in: ProductUpdate
) -> Any:
    data = product_in.model_dump(exclude_unset=True)
    tax_ids = data.pop("tax_ids", None) if "tax_ids" in data else None
    needs_recompute = "costo_actual" in data or "margen_pct" in data
    db_product.sqlmodel_update(data)
    if needs_recompute:
        db_product.precio_venta = _compute_precio_venta(
            db_product.costo_actual, db_product.margen_pct
        )
    session.add(db_product)
    session.commit()
    session.refresh(db_product)
    if tax_ids is not None:
        _sync_product_taxes(session, db_product, tax_ids)
        session.refresh(db_product)
    return db_product


def _sync_product_taxes(
    session: Session, product: Product, tax_ids: list[uuid.UUID]
) -> None:
    """Replace all tax assignments for ``product`` so that only ``tax_ids`` remain."""
    session.exec(delete(ProductTax).where(col(ProductTax.product_id) == product.id))
    for tid in tax_ids:
        session.add(ProductTax(product_id=product.id, tax_id=tid))
    session.commit()


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------
_Q2 = Decimal("0.01")


class BusinessError(ValueError):
    """Expected business-rule failure carrying a stable code for the UI.

    The route layer maps it to an HTTP 400 whose ``detail`` is
    ``{"code": ..., "message": ...}``; the frontend translates ``code``.
    """

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _money(value: Decimal) -> Decimal:
    return value.quantize(_Q2)


def next_document_number(
    *, session: Session, document_type_id: uuid.UUID, year: int
) -> int:
    """Claim the next number for a document type / year.

    Uses SELECT FOR UPDATE on the sequence row so concurrent transactions
    serialize on it; the row is created on first use inside a savepoint so a
    lost insert race falls back to reading the committed row.
    """
    sequence = session.exec(
        select(DocumentSequence)
        .where(
            DocumentSequence.document_type_id == document_type_id,
            DocumentSequence.year == year,
        )
        .with_for_update()
    ).first()
    if sequence is None:
        try:
            with session.begin_nested():
                sequence = DocumentSequence(
                    document_type_id=document_type_id, year=year, last_number=0
                )
                session.add(sequence)
        except IntegrityError:
            # Another transaction created the row first; lock it now.
            sequence = session.exec(
                select(DocumentSequence)
                .where(
                    DocumentSequence.document_type_id == document_type_id,
                    DocumentSequence.year == year,
                )
                .with_for_update()
            ).one()
    sequence.last_number += 1
    session.add(sequence)
    session.flush()
    return sequence.last_number


def create_document(
    *, session: Session, document_in: DocumentCreate, user_id: uuid.UUID
) -> tuple[Document, list[CostChangeSuggestion]]:
    """Create a document with lines, taxes and payments in one transaction.

    Returns the document plus any cost-change suggestions computed for
    purchases (never applied automatically; the user decides on the UI).
    """
    document, cost_suggestions = _create_document_in_tx(
        session=session, document_in=document_in, user_id=user_id
    )
    session.commit()
    session.refresh(document)
    return document, cost_suggestions


def documents_for_counterpart(
    session: Session, contraparte_type: CounterpartType, contraparte_id: uuid.UUID
) -> list[tuple[Document, str]]:
    """Distinct documents of a counterpart (with the document type name).

    Used by the hard-delete guard for customers and suppliers: a counterpart
    referenced by any document (the ``contraparte_*`` columns are polymorphic
    and have no DB FK) cannot be deleted.
    """
    return list(
        session.exec(
            select(Document, DocumentType.name)
            .join(DocumentType, col(Document.document_type_id) == col(DocumentType.id))
            .where(
                col(Document.contraparte_type) == contraparte_type,
                col(Document.contraparte_id) == contraparte_id,
            )
            .distinct()
            .order_by(col(Document.fecha))
        ).all()
    )


def _receipt_leftovers(
    session: Session, contraparte_type: CounterpartType, contraparte_id: uuid.UUID
) -> list[tuple[Document, Decimal]]:
    """Active receipts of a counterpart with their unallocated leftover, FIFO.

    Leftover = receipt total minus everything it already imputed (append-only
    allocation rows). Used to materialize imputations when a later document
    consumes the counterpart's credit in favor.
    """
    receipts = session.exec(
        select(Document)
        .join(
            DocumentType,
            col(Document.document_type_id) == col(DocumentType.id),
        )
        .where(
            col(Document.contraparte_type) == contraparte_type,
            col(Document.contraparte_id) == contraparte_id,
            col(Document.estado) == DocumentStatus.ACTIVE,
            col(DocumentType.operation) == DocumentOperation.RECIBO,
        )
        .order_by(
            col(Document.fecha).asc(),
            col(Document.created_at).asc(),
            col(Document.numero).asc(),
        )
    ).all()
    rows: list[tuple[Document, Decimal]] = []
    for receipt in receipts:
        allocated = session.exec(
            select(func.coalesce(func.sum(DocumentPaymentAllocation.monto), 0)).where(
                col(DocumentPaymentAllocation.receipt_document_id) == receipt.id
            )
        ).one()
        leftover = _money(receipt.total - Decimal(allocated))
        if leftover > 0:
            rows.append((receipt, leftover))
    return rows


def _create_document_in_tx(
    *,
    session: Session,
    document_in: DocumentCreate,
    user_id: uuid.UUID,
    parent_document_id: uuid.UUID | None = None,
    parent_line_ids: dict[int, uuid.UUID] | None = None,
) -> tuple[Document, list[CostChangeSuggestion]]:
    """Transactional core of document creation (no commit/refresh).

    Prices carry IVA inside (retail convention): line-tax rows are an
    informational breakdown and never change the total; only document-level
    taxes (percepciones) add on top. Raises ValueError on business-rule
    violations (the route layer turns it into a 400).
    """
    doc_type = session.get(DocumentType, document_in.document_type_id)
    if not doc_type or not doc_type.is_active:
        raise BusinessError("document_type_not_found", "Document type not found")

    if doc_type.tipo_contraparte is None:
        if document_in.contraparte_id is not None:
            raise BusinessError(
                "counterpart_not_allowed",
                "This document type does not take a counterpart",
            )
    else:
        if document_in.contraparte_id is None:
            raise BusinessError(
                "counterpart_required", "This document type requires a counterpart"
            )
        counterpart: Customer | Supplier | None
        if doc_type.tipo_contraparte == CounterpartType.CUSTOMER:
            counterpart = session.get(Customer, document_in.contraparte_id)
        else:
            counterpart = session.get(Supplier, document_in.contraparte_id)
        if not counterpart:
            raise BusinessError("counterpart_not_found", "Counterpart not found")
        if not counterpart.is_active:
            raise BusinessError("counterpart_inactive", "The counterpart is inactive")

    fecha = (
        document_in.fecha.replace(tzinfo=document_in.fecha.tzinfo or UTC)
        if document_in.fecha
        else datetime.now(UTC)
    )
    year = fecha.year

    # Lines and their taxes; acc[tax_id] aggregates document-level taxes.
    # Computed values are collected first (plain tuples); ORM rows are built
    # once the Document exists, with explicit FKs.
    line_tax_row = tuple[uuid.UUID, Decimal, Decimal]  # tax_id, base, monto
    line_spec = tuple[
        int,
        uuid.UUID,
        uuid.UUID | None,
        Decimal,
        Decimal,
        Decimal,
        Decimal,
        Decimal,
        Decimal,
        list[line_tax_row],
    ]
    line_specs: list[line_spec] = []
    subtotal = Decimal("0")
    doc_tax_acc: dict[uuid.UUID, dict[str, Any]] = {}
    is_adjustment = doc_type.operation == DocumentOperation.AJUSTE
    for index, line_in in enumerate(document_in.lines, start=1):
        product = session.get(Product, line_in.product_id)
        if not product:
            raise BusinessError(
                "product_not_found", f"Product not found: {line_in.product_id}"
            )
        if line_in.variant_id is not None:
            variant = session.get(ProductVariant, line_in.variant_id)
            if not variant or variant.product_id != product.id:
                raise BusinessError(
                    "variant_not_found", "Variant not found in this product"
                )
        # Stock adjustments (AJS) carry a signed per-line quantity; every other
        # operation requires a positive quantity.
        if not is_adjustment and line_in.cantidad <= 0:
            raise BusinessError(
                "quantity_must_be_positive",
                "Line quantity must be positive for this operation",
            )
        precio = (
            line_in.precio_unit
            if line_in.precio_unit is not None
            else (
                product.costo_actual
                if doc_type.operation == DocumentOperation.COMPRA
                else product.precio_venta
            )
        )
        costo = (
            line_in.costo_unitario
            if line_in.costo_unitario is not None
            else product.costo_actual
        )
        bruto = _money(precio * line_in.cantidad)
        if is_adjustment:
            # Adjustments never touch money; discounts are not meaningful.
            descuento_monto = Decimal("0")
        else:
            descuento_monto = (
                _money(line_in.descuento_monto)
                if line_in.descuento_monto is not None
                else _money(bruto * line_in.descuento_pct / Decimal("100"))
            )
            if descuento_monto > bruto:
                raise BusinessError(
                    "line_discount_exceeds", "Line discount exceeds the line amount"
                )
        subtotal_line = bruto - descuento_monto

        if is_adjustment:
            taxes = []
        elif line_in.tax_ids is None:
            taxes = list(product.taxes)
        else:
            wanted = set(line_in.tax_ids)
            available = {t.id: t for t in product.taxes}
            missing = wanted - available.keys()
            if missing:
                raise BusinessError(
                    "taxes_not_assigned",
                    f"Taxes not assigned to product {product.name}: {missing}",
                )
            taxes = [available[tid] for tid in wanted]

        line_taxes: list[line_tax_row] = []
        for tax in taxes:
            if tax.aplica_a == TaxAppliesTo.LINEA:
                monto = (
                    _money(subtotal_line * tax.rate / Decimal("100"))
                    if tax.is_percent
                    else tax.rate
                )
                line_taxes.append((tax.id, subtotal_line, monto))
            else:
                acc = doc_tax_acc.setdefault(
                    tax.id,
                    {
                        "base": Decimal("0"),
                        "rate": tax.rate,
                        "is_percent": tax.is_percent,
                    },
                )
                acc["base"] += subtotal_line
        line_specs.append(
            (
                index,
                product.id,
                line_in.variant_id,
                line_in.cantidad,
                precio,
                costo,
                line_in.descuento_pct,
                descuento_monto,
                subtotal_line,
                line_taxes,
            )
        )
        subtotal += subtotal_line

    if is_adjustment:
        descuento_total = Decimal("0")
    else:
        if document_in.descuento_total > subtotal:
            raise BusinessError(
                "document_discount_exceeds", "Document discount exceeds the subtotal"
            )
        descuento_total = document_in.descuento_total

    number = next_document_number(
        session=session, document_type_id=doc_type.id, year=year
    )
    numero = f"{year}-{doc_type.prefix}-{number:08d}"

    doc_tax_rows: list[line_tax_row] = []
    doc_taxes_total = Decimal("0")
    for tax_id, acc in doc_tax_acc.items():
        monto = (
            _money(acc["base"] * acc["rate"] / Decimal("100"))
            if acc["is_percent"]
            else acc["rate"]
        )
        doc_tax_rows.append((tax_id, acc["base"], monto))
        doc_taxes_total += monto

    for payment_in in document_in.payments:
        if not session.get(PaymentMethod, payment_in.payment_method_id):
            raise BusinessError(
                "payment_method_not_found",
                f"Payment method not found: {payment_in.payment_method_id}",
            )

    total = subtotal - descuento_total + doc_taxes_total
    favor_monto = Decimal("0")
    favor_allocations: list[tuple[Document, Decimal]] = []
    if (
        doc_type.tipo_contraparte is not None
        and document_in.contraparte_id is not None
        and doc_type.signo_caja != 0
    ):
        party = doc_type.tipo_contraparte
        is_credit_direction = (
            party == CounterpartType.CUSTOMER and doc_type.signo_caja > 0
        ) or (party == CounterpartType.SUPPLIER and doc_type.signo_caja < 0)
        if is_credit_direction:
            # Credit in favor (negative counterpart balance) auto-covers the
            # unpaid portion: it reduces the pending but never moves cash.
            if party == CounterpartType.CUSTOMER:
                counterpart = session.get(Customer, document_in.contraparte_id)
            else:
                counterpart = session.get(Supplier, document_in.contraparte_id)
            counterpart_bal = counterpart.saldo if counterpart else Decimal("0")
            if counterpart_bal < 0:
                paid_marks = Decimal("0")
                for payment_in in document_in.payments:
                    method = session.get(PaymentMethod, payment_in.payment_method_id)
                    if method is not None and method.marks_paid:
                        paid_marks += payment_in.monto
                unpaid = max(total - paid_marks, Decimal("0"))
                favor_used = min(-counterpart_bal, unpaid)
                remaining = favor_used
                for receipt, leftover in _receipt_leftovers(
                    session, party, document_in.contraparte_id
                ):
                    if remaining <= 0:
                        break
                    portion = min(leftover, remaining)
                    if portion > 0:
                        favor_allocations.append((receipt, portion))
                        remaining -= portion
                favor_monto = remaining

    document = Document(
        document_type_id=doc_type.id,
        numero=numero,
        year=year,
        fecha=fecha,
        contraparte_type=doc_type.tipo_contraparte,
        contraparte_id=document_in.contraparte_id,
        user_id=user_id,
        subtotal=subtotal,
        descuento_total=descuento_total,
        total=total,
        favor_monto=_money(favor_monto),
        parent_document_id=parent_document_id,
    )
    session.add(document)
    session.flush()

    # Materialize the receipt imputations that cover the favor portion.
    for receipt, portion in favor_allocations:
        session.add(
            DocumentPaymentAllocation(
                receipt_document_id=receipt.id,
                document_id=document.id,
                monto=portion,
            )
        )

    for (
        orden,
        product_id,
        variant_id,
        cantidad,
        precio,
        costo,
        descuento_pct,
        descuento_monto,
        subtotal_line,
        line_taxes,
    ) in line_specs:
        line = DocumentLine(
            document_id=document.id,
            orden=orden,
            product_id=product_id,
            variant_id=variant_id,
            cantidad=cantidad,
            precio_unit=precio,
            costo_unitario=costo,
            descuento_pct=descuento_pct,
            descuento_monto=descuento_monto,
            subtotal_line=subtotal_line,
            parent_line_id=(parent_line_ids or {}).get(orden),
        )
        session.add(line)
        for tax_id, base, monto in line_taxes:
            session.add(
                DocumentLineTax(
                    document_line_id=line.id,
                    tax_id=tax_id,
                    base=base,
                    monto=monto,
                    aplicado=True,
                )
            )
    for tax_id, base, monto in doc_tax_rows:
        session.add(
            DocumentTax(document_id=document.id, tax_id=tax_id, base=base, monto=monto)
        )
    for payment_in in document_in.payments:
        session.add(
            DocumentPayment(
                document_id=document.id,
                payment_method_id=payment_in.payment_method_id,
                monto=payment_in.monto,
                comision_pct=payment_in.comision_pct,
                fecha_acreditacion=payment_in.fecha_acreditacion,
            )
        )
    session.flush()

    # --- Integration hooks (must run in this same transaction) ---
    cost_suggestions = _purchase_cost_hook(
        session=session, document=document
    )  # Phase 5
    _stock_movements_hook(session=session, document=document)  # Phase 6
    _financial_movements_hook(session=session, document=document)  # Phase 7

    return document, cost_suggestions


def get_line_voided_quantities(
    *, session: Session, document: Document
) -> dict[uuid.UUID, Decimal]:
    """Cantidad already reverted per line of ``document``, from active NCs."""
    rows = session.exec(
        select(DocumentLine.parent_line_id, func.sum(DocumentLine.cantidad))
        .join(Document, col(Document.id) == DocumentLine.document_id)
        .where(col(Document.parent_document_id) == document.id)
        .where(Document.estado == DocumentStatus.ACTIVE)
        .where(col(DocumentLine.parent_line_id).is_not(None))
        .group_by(col(DocumentLine.parent_line_id))
    ).all()
    return {line_id: total for line_id, total in rows if line_id is not None}


def void_document(
    *,
    session: Session,
    document_id: uuid.UUID,
    void_in: DocumentVoidCreate,
    user_id: uuid.UUID,
) -> Document:
    """Void ``document`` totally or partially by issuing its mirror NC.

    Quantities are line-based; previous NCs count towards the remaining
    quantity. The original switches to ``voided`` once every line is fully
    reverted; only then the document-level discount is reversed in the NC
    (partial NCs keep it attached to the original document).
    """
    original = session.exec(
        select(Document)
        .where(Document.id == document_id)
        .options(
            selectinload(Document.document_type),  # type: ignore
            selectinload(Document.payments),  # type: ignore
            selectinload(Document.lines).selectinload(DocumentLine.taxes),  # type: ignore
            selectinload(Document.taxes),  # type: ignore
        )
    ).first()
    if not original:
        raise BusinessError("document_not_found", "Document not found")
    if original.estado == DocumentStatus.VOIDED:
        raise BusinessError("document_already_voided", "Document is already voided")
    original_type = original.document_type
    if original_type is None:
        raise BusinessError("document_type_missing", "Document has no document type")
    nc_type_id = original_type.void_document_type_id
    if nc_type_id is None:
        raise BusinessError(
            "document_not_voidable",
            f"Documents of type '{original_type.name}' are not voidable",
        )

    voided_qty = get_line_voided_quantities(session=session, document=original)
    remaining = {
        line.id: line.cantidad - voided_qty.get(line.id, Decimal("0"))
        for line in original.lines
    }
    by_id = {line.id: line for line in original.lines}

    requested: dict[uuid.UUID, Decimal] = {}
    if void_in.lines:
        for void_line in void_in.lines:
            if void_line.document_line_id not in by_id:
                raise BusinessError(
                    "void_line_mismatch", "A void line does not belong to the document"
                )
            if remaining[void_line.document_line_id] <= 0:
                raise BusinessError(
                    "void_line_nothing_left", "A void line has nothing left to void"
                )
            acc = requested.get(void_line.document_line_id, Decimal("0"))
            requested[void_line.document_line_id] = acc + void_line.cantidad
    else:
        requested = {line_id: qty for line_id, qty in remaining.items() if qty > 0}
    if not requested:
        raise BusinessError("nothing_to_void", "Nothing left to void")
    for line_id, qty in requested.items():
        if qty > remaining[line_id]:
            raise BusinessError(
                "void_quantity_exceeds",
                f"Void quantity ({qty}) exceeds what is left "
                f"({remaining[line_id]}) for a line",
            )

    lines_after = {
        line.id: remaining[line.id] - requested.get(line.id, Decimal("0"))
        for line in original.lines
    }
    becomes_voided = all(qty <= 0 for qty in lines_after.values())

    # Doc-level taxes assigned to the original document (percepciones).
    original_doc_tax_ids = {dt.tax_id for dt in original.taxes}

    nc_lines: list[DocumentLineCreate] = []
    parent_line_ids: dict[int, uuid.UUID] = {}
    orden = 0
    for line in sorted(original.lines, key=lambda x: x.orden):
        void_qty = requested.get(line.id)
        if void_qty is None:
            continue
        orden += 1
        descuento_pct: Decimal
        descuento_monto: Decimal | None
        if line.descuento_pct > 0:
            descuento_pct, descuento_monto = line.descuento_pct, None
        elif line.descuento_monto > 0:
            ratio = void_qty / line.cantidad
            descuento_pct, descuento_monto = (
                Decimal("0"),
                _money(line.descuento_monto * ratio),
            )
        else:
            descuento_pct, descuento_monto = Decimal("0"), None
        # Line taxes applied to the original line + percepciones still
        # assigned to the product so the NC reverses them proportionally.
        product = session.get(Product, line.product_id)
        product_tax_ids = {t.id for t in product.taxes} if product else set()
        line_tax_ids = {t.tax_id for t in line.taxes if t.aplicado}
        tax_ids = sorted(line_tax_ids | (original_doc_tax_ids & product_tax_ids))
        nc_lines.append(
            DocumentLineCreate(
                product_id=line.product_id,
                variant_id=line.variant_id,
                cantidad=void_qty,
                precio_unit=line.precio_unit,
                descuento_pct=descuento_pct,
                descuento_monto=descuento_monto,
                tax_ids=tax_ids,
                costo_unitario=line.costo_unitario,
            )
        )
        parent_line_ids[orden] = line.id

    # Void NCs reverse the money: unless the caller explicitly provides refund
    # payments, mirror the original payments scaled to the voided fraction so
    # the cash/commission ledger is reversed together with the document.
    payments_in = list(void_in.payments)
    if not payments_in:
        total_gross = sum(line.precio_unit * line.cantidad for line in original.lines)
        voided_gross = sum(
            line.precio_unit * qty
            for line_id, qty in requested.items()
            for line in original.lines
            if line.id == line_id
        )
        ratio = _money(voided_gross / total_gross) if total_gross else Decimal("0")
        if ratio > 0:
            for payment in original.payments:
                monto = _money(payment.monto * ratio)
                if monto > 0:
                    payments_in.append(
                        DocumentPaymentCreate(
                            payment_method_id=payment.payment_method_id,
                            monto=monto,
                            comision_pct=payment.comision_pct,
                            fecha_acreditacion=payment.fecha_acreditacion,
                        )
                    )

    nc_in = DocumentCreate(
        document_type_id=nc_type_id,
        contraparte_id=original.contraparte_id,
        descuento_total=original.descuento_total if becomes_voided else Decimal("0"),
        lines=nc_lines,
        payments=payments_in,
    )
    nc, _ = _create_document_in_tx(
        session=session,
        document_in=nc_in,
        user_id=user_id,
        parent_document_id=original.id,
        parent_line_ids=parent_line_ids,
    )
    if becomes_voided:
        original.estado = DocumentStatus.VOIDED
        session.add(original)
    session.commit()
    session.refresh(nc)
    return nc


def suggest_fiscal_sale_type(
    *, session: Session, customer_id: uuid.UUID
) -> DocumentType:
    """Resolve Factura A/B/C from the business/customer tax condition combo.

    RI business + RI customer → A; RI business + anyone else → B;
    non-RI business → C. Matched by seeded type name.
    """
    customer = session.get(Customer, customer_id)
    if not customer:
        raise BusinessError("customer_not_found", "Customer not found")
    settings = session.exec(select(BusinessSettings)).first()
    if not settings:
        raise BusinessError(
            "business_settings_not_found", "Business settings not found"
        )
    business_is_ri = settings.condicion_fiscal == TaxCondition.RI
    customer_is_ri = customer.condicion_fiscal == TaxCondition.RI
    letter = (
        "A" if business_is_ri and customer_is_ri else "B" if business_is_ri else "C"
    )
    doc_type = session.exec(
        select(DocumentType).where(
            col(DocumentType.name) == FISCAL_SALE_TYPE_NAMES[letter]
        )
    ).first()
    if not doc_type:
        raise ValueError(
            f"Seeded document type '{FISCAL_SALE_TYPE_NAMES[letter]}' not found"
        )
    return doc_type


def convert_quote_to_invoice(
    *, session: Session, document_id: uuid.UUID, user_id: uuid.UUID
) -> Document:
    """Convert a quote into an invoice in one click (exact copy).

    The quote stays active; a quote has at most one ACTIVE invoice child
    (if the invoice gets voided, the quote can be converted again).
    Prices, discounts, taxes and the cost snapshot are copied verbatim.
    """
    quote = session.exec(
        select(Document)
        .where(Document.id == document_id)
        .options(
            selectinload(Document.document_type),  # type: ignore
            selectinload(Document.lines).selectinload(DocumentLine.taxes),  # type: ignore
            selectinload(Document.taxes),  # type: ignore
        )
    ).first()
    if not quote:
        raise BusinessError("document_not_found", "Document not found")
    if quote.document_type is None or quote.document_type.operation != (
        DocumentOperation.COTIZACION
    ):
        raise BusinessError("not_a_quote", "Only quotes can be converted to invoices")
    if quote.estado == DocumentStatus.VOIDED:
        raise BusinessError("quote_voided", "A voided quote cannot be converted")
    if quote.contraparte_id is None:
        raise BusinessError("quote_no_customer", "The quote has no customer")
    existing = session.exec(
        select(Document).where(
            col(Document.parent_document_id) == quote.id,
            Document.estado == DocumentStatus.ACTIVE,
        )
    ).first()
    if existing:
        raise BusinessError(
            "quote_already_converted",
            f"Quote already converted (invoice {existing.numero})",
        )

    doc_type = suggest_fiscal_sale_type(
        session=session, customer_id=quote.contraparte_id
    )
    original_doc_tax_ids = {dt.tax_id for dt in quote.taxes}
    lines: list[DocumentLineCreate] = []
    parent_line_ids: dict[int, uuid.UUID] = {}
    orden = 0
    for line in sorted(quote.lines, key=lambda x: x.orden):
        orden += 1
        product = session.get(Product, line.product_id)
        product_tax_ids = {t.id for t in product.taxes} if product else set()
        line_tax_ids = {t.tax_id for t in line.taxes if t.aplicado}
        tax_ids = sorted(line_tax_ids | (original_doc_tax_ids & product_tax_ids))
        lines.append(
            DocumentLineCreate(
                product_id=line.product_id,
                variant_id=line.variant_id,
                cantidad=line.cantidad,
                precio_unit=line.precio_unit,
                descuento_pct=line.descuento_pct,
                descuento_monto=(
                    line.descuento_monto if line.descuento_pct == 0 else None
                ),
                tax_ids=tax_ids,
                costo_unitario=line.costo_unitario,
            )
        )
        parent_line_ids[orden] = line.id

    invoice_in = DocumentCreate(
        document_type_id=doc_type.id,
        contraparte_id=quote.contraparte_id,
        descuento_total=quote.descuento_total,
        lines=lines,
        payments=[],
    )
    invoice, _ = _create_document_in_tx(
        session=session,
        document_in=invoice_in,
        user_id=user_id,
        parent_document_id=quote.id,
        parent_line_ids=parent_line_ids,
    )
    session.commit()
    session.refresh(invoice)
    return invoice


def _purchase_cost_hook(
    *, session: Session, document: Document
) -> list[CostChangeSuggestion]:
    """Phase 5: compute cost-change suggestions for purchase documents.

    Nothing is mutated here: the response proposes each line whose purchase
    price is higher than the product's current cost (``Product.costo_actual``)
    and the user decides. Prices at or below the product's current cost never
    suggest a change, even on a first purchase from a supplier.
    ``previous_cost`` is the supplier's recorded cost (``None`` when the pair
    is not registered yet).
    """
    if document.parent_document_id is not None:
        return []
    doc_type = session.get(DocumentType, document.document_type_id)
    if (
        doc_type is None
        or doc_type.operation != DocumentOperation.COMPRA
        or document.contraparte_type != CounterpartType.SUPPLIER
        or document.contraparte_id is None
    ):
        return []
    supplier_id = document.contraparte_id
    lines = session.exec(
        select(DocumentLine).where(DocumentLine.document_id == document.id)
    ).all()
    if not lines:
        return []
    product_ids = {line.product_id for line in lines}
    pairs = {
        (sp.supplier_id, sp.product_id): sp
        for sp in session.exec(
            select(SupplierProduct).where(
                col(SupplierProduct.supplier_id) == supplier_id,
                col(SupplierProduct.product_id).in_(product_ids),
            )
        ).all()
    }
    products = {
        p.id: p
        for p in session.exec(
            select(Product).where(col(Product.id).in_(product_ids))
        ).all()
    }
    suggestions: list[CostChangeSuggestion] = []
    for line in lines:
        product = products.get(line.product_id)
        if product is None or line.precio_unit <= product.costo_actual:
            # The purchase price is not above the product's current cost, so
            # there is nothing to suggest (even on a first purchase).
            continue
        pair = pairs.get((supplier_id, line.product_id))
        suggestions.append(
            CostChangeSuggestion(
                supplier_id=supplier_id,
                product_id=line.product_id,
                product_name=product.name,
                previous_cost=pair.costo_actual if pair is not None else None,
                suggested_cost=_money(line.precio_unit),
                is_reference=pair.es_referencia if pair is not None else False,
            )
        )
    return suggestions


def _apply_reference_cost(
    *, session: Session, pair: SupplierProduct, product: Product
) -> None:
    """Make the reference supplier's cost drive ``Product.costo_actual``.

    Also recalculates ``precio_venta`` from the existing margin so the change
    flows through the price chain atomically with the cost update.
    """
    product.costo_actual = pair.costo_actual
    product.precio_venta = _compute_precio_venta(
        product.costo_actual, product.margen_pct
    )
    session.add(product)


def _sync_supplier_flags(*, session: Session, pair: SupplierProduct) -> None:
    """Keep reference/default flags unique per product and propagate costs.

    When ``pair`` becomes the reference, any other supplier of the product is
    unflagged and the product cost is sourced from ``pair``. When the product
    has no reference supplier at all, ``pair`` is auto-promoted so the product
    cost follows the supplier whose cost the user just registered/confirmed.
    """
    product = session.get(Product, pair.product_id)
    if product is None:
        raise ValueError("Product not found")
    others = session.exec(
        select(SupplierProduct).where(
            col(SupplierProduct.product_id) == pair.product_id,
            col(SupplierProduct.supplier_id) != pair.supplier_id,
        )
    ).all()
    for other in others:
        changed = False
        if pair.es_referencia and other.es_referencia:
            other.es_referencia = False
            changed = True
        if pair.es_default and other.es_default:
            other.es_default = False
            changed = True
        if changed:
            session.add(other)
    if pair.es_referencia or not any(o.es_referencia for o in others):
        if not pair.es_referencia:
            # No reference supplier for this product yet: the pair whose cost
            # was just registered/confirmed becomes the reference so the
            # product cost and sale price follow it.
            pair.es_referencia = True
        _apply_reference_cost(session=session, pair=pair, product=product)


def create_supplier_product(
    *, session: Session, supplier_product_in: SupplierProductCreate
) -> SupplierProduct:
    """Register a supplier-product pair with its supplier cost."""
    if not session.get(Supplier, supplier_product_in.supplier_id):
        raise BusinessError("supplier_not_found", "Supplier not found")
    if not session.get(Product, supplier_product_in.product_id):
        raise ValueError("Product not found")
    pair = session.get(
        SupplierProduct,
        (supplier_product_in.supplier_id, supplier_product_in.product_id),
    )
    if pair is not None:
        raise ValueError("This supplier-product pair already exists")
    pair = SupplierProduct.model_validate(supplier_product_in)
    pair.costo_anterior = Decimal("0")
    session.add(pair)
    session.flush()
    _sync_supplier_flags(session=session, pair=pair)
    session.commit()
    session.refresh(pair)
    return pair


def update_supplier_product(
    *,
    session: Session,
    supplier_id: uuid.UUID,
    product_id: uuid.UUID,
    supplier_product_in: SupplierProductUpdate,
) -> SupplierProduct:
    """Update a supplier cost and/or its reference/default flags.

    A cost change moves the old value into ``costo_anterior`` and stamps
    ``fecha_actualizacion``; if the pair is the reference supplier the change
    propagates to ``Product.costo_actual`` in the same transaction.
    """
    pair = session.get(SupplierProduct, (supplier_id, product_id))
    if pair is None:
        raise ValueError("Supplier-product pair not found")
    data = supplier_product_in.model_dump(exclude_unset=True)
    if "costo_actual" in data and data["costo_actual"] != pair.costo_actual:
        pair.costo_anterior = pair.costo_actual
        pair.costo_actual = data["costo_actual"]
        pair.fecha_actualizacion = datetime.now(UTC)
        data.pop("costo_actual")
    pair.sqlmodel_update(data)
    session.add(pair)
    session.flush()
    _sync_supplier_flags(session=session, pair=pair)
    session.commit()
    session.refresh(pair)
    return pair


def delete_supplier_product(
    *, session: Session, supplier_id: uuid.UUID, product_id: uuid.UUID
) -> None:
    """Unregister a supplier-product pair (does not touch the product)."""
    pair = session.get(SupplierProduct, (supplier_id, product_id))
    if pair is None:
        raise ValueError("Supplier-product pair not found")
    session.delete(pair)
    session.commit()


def _apply_stock_delta(
    *,
    session: Session,
    document: Document,
    line: DocumentLine,
    delta: Decimal,
    allow_negative: bool,
    motivo: str,
) -> None:
    """Atomically apply a signed stock delta and append the ledger row.

    When negative stock is not allowed, the UPDATE itself guards
    ``stock_current + delta >= 0``; a 0-rowcount result means the operation
    would take the stock below zero and raises ``ValueError``.
    """
    if line.variant_id is not None:
        target: type[Product | ProductVariant] = ProductVariant
        key = col(ProductVariant.id) == line.variant_id
    else:
        target = Product
        key = col(Product.id) == line.product_id
    conditions = [key]
    if not allow_negative:
        conditions.append(col(target.stock_current) + delta >= Decimal("0"))
    result = session.exec(
        update(target)
        .where(*conditions)
        .values(stock_current=col(target.stock_current) + delta)
    )
    if result.rowcount == 0:
        raise BusinessError(
            "insufficient_stock", "Insufficient stock to complete the operation"
        )
    session.add(
        StockMovement(
            product_id=line.product_id,
            variant_id=line.variant_id,
            document_id=document.id,
            document_line_id=line.id,
            signo=1 if delta > 0 else -1,
            cantidad=delta,
            motivo=motivo,
            user_id=document.user_id,
        )
    )


def _apply_account_delta(
    *,
    session: Session,
    document: Document,
    account_id: uuid.UUID,
    delta: Decimal,
    tipo: AccountMovementType,
    payment: DocumentPayment | None = None,
) -> None:
    """Atomically update a financial account saldo and append the ledger row."""
    result = session.exec(
        update(FinancialAccount)
        .where(col(FinancialAccount.id) == account_id)
        .values(saldo=col(FinancialAccount.saldo) + delta)
    )
    if result.rowcount == 0:
        raise BusinessError(
            "financial_account_not_found", "Financial account not found"
        )
    session.add(
        AccountMovement(
            financial_account_id=account_id,
            document_id=document.id,
            payment_method_id=payment.payment_method_id if payment else None,
            monto=delta,
            tipo=tipo,
            fecha=document.fecha,
            fecha_acreditacion=payment.fecha_acreditacion if payment else None,
            user_id=document.user_id,
        )
    )


def _apply_customer_balance_delta(
    *,
    session: Session,
    document: Document,
    delta: Decimal,
    requires_credit_limit: bool,
) -> None:
    """Atomically update Customer.saldo and append the current-account ledger.

    When a credit limit applies (0 = no limit), the UPDATE guards
    ``saldo + delta <= limite_credito``; a 0-rowcount result raises.
    """
    customer = session.get(Customer, document.contraparte_id)
    if customer is None:
        raise BusinessError("customer_not_found", "Customer not found")
    conditions = [col(Customer.id) == customer.id]
    if requires_credit_limit and customer.limite_credito:
        conditions.append(col(Customer.saldo) + delta <= customer.limite_credito)
    result = session.exec(
        update(Customer).where(*conditions).values(saldo=col(Customer.saldo) + delta)
    )
    if result.rowcount == 0:
        raise BusinessError(
            "credit_limit_exceeded", "Operation exceeds the customer's credit limit"
        )
    session.add(
        CustomerAccountMovement(
            customer_id=customer.id, document_id=document.id, monto=delta
        )
    )


def _apply_supplier_balance_delta(
    *, session: Session, document: Document, delta: Decimal
) -> None:
    """Atomically update Supplier.saldo and append the current-account ledger."""
    supplier = session.get(Supplier, document.contraparte_id)
    if supplier is None:
        raise BusinessError("supplier_not_found", "Supplier not found")
    result = session.exec(
        update(Supplier)
        .where(col(Supplier.id) == supplier.id)
        .values(saldo=col(Supplier.saldo) + delta)
    )
    if result.rowcount == 0:
        raise BusinessError("supplier_not_found", "Supplier not found")
    session.add(
        SupplierAccountMovement(
            supplier_id=supplier.id, document_id=document.id, monto=delta
        )
    )


def _stock_movements_hook(*, session: Session, document: Document) -> None:
    """Phase 6: emit StockMovement rows and reconcile product stock caches."""
    doc_type = session.get(DocumentType, document.document_type_id)
    if doc_type is None:
        return
    is_adjustment = doc_type.operation == DocumentOperation.AJUSTE
    if doc_type.signo_stock == 0 and not is_adjustment:
        return
    settings = session.exec(select(BusinessSettings)).first()
    allow_negative = settings.allow_negative_stock if settings else False
    lines = session.exec(
        select(DocumentLine).where(DocumentLine.document_id == document.id)
    ).all()
    for line in lines:
        delta = line.cantidad if is_adjustment else doc_type.signo_stock * line.cantidad
        if delta == 0:
            continue
        _apply_stock_delta(
            session=session,
            document=document,
            line=line,
            delta=delta,
            allow_negative=allow_negative or is_adjustment,
            motivo=doc_type.name,
        )


def _financial_movements_hook(*, session: Session, document: Document) -> None:
    """Phase 7: emit AccountMovement + current-account ledger rows."""
    doc_type = session.get(DocumentType, document.document_type_id)
    if doc_type is None or doc_type.signo_caja == 0:
        return
    payments = session.exec(
        select(DocumentPayment).where(DocumentPayment.document_id == document.id)
    ).all()
    paid = Decimal("0")
    for payment in payments:
        method = session.get(PaymentMethod, payment.payment_method_id)
        if method is None:
            continue
        if not method.marks_paid:
            # Current-account methods neither mark the document as paid nor
            # move a financial account: the amount stays in the counterpart's
            # balance delta below.
            continue
        paid += payment.monto
        account = session.get(FinancialAccount, method.financial_account_id)
        if account is None:
            continue
        delta = _money(doc_type.signo_caja * payment.monto)
        tipo = (
            AccountMovementType.COBRO
            if doc_type.signo_caja > 0
            else AccountMovementType.PAGO
        )
        _apply_account_delta(
            session=session,
            document=document,
            account_id=account.id,
            delta=delta,
            tipo=tipo,
            payment=payment,
        )
        if payment.comision_pct:
            comision = _money(payment.monto * payment.comision_pct / Decimal("100"))
            if comision > 0:
                # Commission is always a cost: it reduces the account balance.
                _apply_account_delta(
                    session=session,
                    document=document,
                    account_id=account.id,
                    delta=-comision,
                    tipo=AccountMovementType.COMISION,
                    payment=payment,
                )

    raw_balance_delta = _money(document.total - paid)
    if document.contraparte_type is None:
        return
    if doc_type.operation == DocumentOperation.RECIBO:
        # A receipt reduces the counterpart balance by its full total; any
        # excess over the outstanding debt stays as an on-account credit
        # (negative balance).
        delta = _money(-document.total)
    elif raw_balance_delta == 0:
        return
    elif document.contraparte_type == CounterpartType.CUSTOMER:
        delta = _money(doc_type.signo_caja * raw_balance_delta)
    else:
        delta = _money(-doc_type.signo_caja * raw_balance_delta)
    if delta == 0:
        return
    if document.contraparte_type == CounterpartType.CUSTOMER:
        requires_limit = delta > 0 and doc_type.operation == DocumentOperation.VENTA
        _apply_customer_balance_delta(
            session=session,
            document=document,
            delta=delta,
            requires_credit_limit=requires_limit,
        )
    else:
        _apply_supplier_balance_delta(session=session, document=document, delta=delta)


def outstanding_documents(
    *, session: Session, contraparte_type: CounterpartType, contraparte_id: uuid.UUID
) -> list[dict[str, Any]]:
    """Documents of a counterpart with a still-unpaid portion, oldest first.

    For customers this means documents whose type increased the debt
    (signo_caja > 0: FA/FB/FC/TCK/NDV); for suppliers the mirror
    (signo_caja < 0: OC/NDC). Pending = total - payments made via methods that
    mark as paid - portions already settled by active receipts.
    """
    direction = (
        col(DocumentType.signo_caja) > 0
        if contraparte_type == CounterpartType.CUSTOMER
        else col(DocumentType.signo_caja) < 0
    )
    docs = session.exec(
        select(Document)
        .join(DocumentType, col(Document.document_type_id) == col(DocumentType.id))
        .where(
            Document.contraparte_type == contraparte_type,
            Document.contraparte_id == contraparte_id,
            Document.estado == DocumentStatus.ACTIVE,
            direction,
        )
        .order_by(
            col(Document.fecha).asc(),
            col(Document.created_at).asc(),
            col(Document.numero).asc(),
        )
    ).all()

    rows: list[dict[str, Any]] = []
    for doc in docs:
        paid = Decimal("0")
        payments = session.exec(
            select(DocumentPayment)
            .join(
                PaymentMethod,
                col(DocumentPayment.payment_method_id) == col(PaymentMethod.id),
            )
            .where(
                col(DocumentPayment.document_id) == doc.id,
                col(PaymentMethod.marks_paid).is_(True),
            )
        ).all()
        for payment in payments:
            paid += payment.monto
        allocated = session.exec(
            select(func.coalesce(func.sum(DocumentPaymentAllocation.monto), 0))
            .join(
                Document,
                col(Document.id) == col(DocumentPaymentAllocation.receipt_document_id),
            )
            .where(
                DocumentPaymentAllocation.document_id == doc.id,
                Document.estado == DocumentStatus.ACTIVE,
            )
        ).one()
        pendiente = _money(doc.total - doc.favor_monto - paid - Decimal(allocated))
        if pendiente > 0:
            rows.append(
                {
                    "document_id": doc.id,
                    "numero": doc.numero,
                    "fecha": doc.fecha,
                    "total": doc.total,
                    "pendiente": pendiente,
                }
            )
    return rows


def create_receipt(
    *, session: Session, receipt_in: PaymentReceiptCreate, user_id: uuid.UUID
) -> Document:
    """Register a standalone payment (receipt) against a counterpart.

    Builds a RECIBO document (RC for customers, RP for suppliers) with the
    given payments, allocates the total FIFO across the counterpart's
    outstanding documents and emits the financial + current-account ledger
    rows in the same transaction. Overpayments stay as an on-account credit
    (negative counterpart balance). Commit/refresh happen at the call site.
    """
    party = receipt_in.contraparte_type
    doc_type = session.exec(
        select(DocumentType).where(
            DocumentType.operation == DocumentOperation.RECIBO,
            DocumentType.tipo_contraparte == party,
            col(DocumentType.is_active).is_(True),
        )
    ).first()
    if doc_type is None:
        raise BusinessError(
            "receipt_type_missing",
            f"No receipt document type seeded for {party} counterparts",
        )

    if party == CounterpartType.CUSTOMER:
        counterpart: Customer | Supplier | None = session.get(
            Customer, receipt_in.contraparte_id
        )
    else:
        counterpart = session.get(Supplier, receipt_in.contraparte_id)
    if counterpart is None:
        raise BusinessError("counterpart_not_found", "Counterpart not found")
    if not counterpart.is_active:
        raise BusinessError("counterpart_inactive", "The counterpart is inactive")

    payment_specs: list[tuple[uuid.UUID, Decimal, Decimal | None, datetime | None]] = []
    total = Decimal("0")
    for payment_in in receipt_in.payments:
        method = session.get(PaymentMethod, payment_in.payment_method_id)
        if method is None:
            raise BusinessError(
                "payment_method_not_found",
                f"Payment method not found: {payment_in.payment_method_id}",
            )
        if not method.marks_paid:
            raise BusinessError(
                "receipt_requires_paid_method",
                "Receipt payments must use a method that marks as paid",
            )
        total += payment_in.monto
        payment_specs.append(
            (
                payment_in.payment_method_id,
                payment_in.monto,
                payment_in.comision_pct,
                payment_in.fecha_acreditacion,
            )
        )
    total = _money(total)

    fecha = (
        receipt_in.fecha.replace(tzinfo=receipt_in.fecha.tzinfo or UTC)
        if receipt_in.fecha
        else datetime.now(UTC)
    )
    year = fecha.year

    number = next_document_number(
        session=session, document_type_id=doc_type.id, year=year
    )
    document = Document(
        document_type_id=doc_type.id,
        numero=f"{year}-{doc_type.prefix}-{number:08d}",
        year=year,
        fecha=fecha,
        contraparte_type=party,
        contraparte_id=receipt_in.contraparte_id,
        user_id=user_id,
        subtotal=Decimal("0"),
        descuento_total=Decimal("0"),
        total=total,
    )
    session.add(document)
    session.flush()

    for method_id, monto, comision_pct, fecha_acreditacion in payment_specs:
        session.add(
            DocumentPayment(
                document_id=document.id,
                payment_method_id=method_id,
                monto=monto,
                comision_pct=comision_pct,
                fecha_acreditacion=fecha_acreditacion,
            )
        )

    # FIFO allocation: oldest outstanding documents first; the remainder stays
    # on account as an implicit credit in the counterpart balance.
    remaining = total
    for row in outstanding_documents(
        session=session,
        contraparte_type=party,
        contraparte_id=receipt_in.contraparte_id,
    ):
        if remaining <= 0:
            break
        portion = min(remaining, row["pendiente"])
        if portion <= 0:
            continue
        session.add(
            DocumentPaymentAllocation(
                receipt_document_id=document.id,
                document_id=row["document_id"],
                monto=portion,
            )
        )
        remaining -= portion
    session.flush()

    _financial_movements_hook(session=session, document=document)
    session.commit()
    session.refresh(document)
    return document


def create_transfer(
    *, session: Session, transfer_in: TransferCreate, user_id: uuid.UUID
) -> Transfer:
    """Create an internal transfer with movements on both accounts (atomic)."""
    if transfer_in.from_account_id == transfer_in.to_account_id:
        raise ValueError("Transfer must be between two different accounts")
    from_account = session.get(FinancialAccount, transfer_in.from_account_id)
    if from_account is None:
        raise ValueError("Source financial account not found")
    to_account = session.get(FinancialAccount, transfer_in.to_account_id)
    if to_account is None:
        raise ValueError("Destination financial account not found")
    fecha = (
        transfer_in.fecha.replace(tzinfo=transfer_in.fecha.tzinfo or UTC)
        if transfer_in.fecha
        else datetime.now(UTC)
    )
    transfer = Transfer(
        from_account_id=from_account.id,
        to_account_id=to_account.id,
        monto=transfer_in.monto,
        fecha=fecha,
        descripcion=transfer_in.descripcion,
        user_id=user_id,
    )
    session.add(transfer)
    session.flush()
    for account_id, delta in (
        (from_account.id, -transfer_in.monto),
        (to_account.id, transfer_in.monto),
    ):
        result = session.exec(
            update(FinancialAccount)
            .where(col(FinancialAccount.id) == account_id)
            .values(saldo=col(FinancialAccount.saldo) + delta)
        )
        if result.rowcount == 0:
            raise BusinessError(
                "financial_account_not_found", "Financial account not found"
            )
        session.add(
            AccountMovement(
                financial_account_id=account_id,
                transfer_id=transfer.id,
                monto=delta,
                tipo=AccountMovementType.TRANSFERENCIA,
                fecha=fecha,
                user_id=user_id,
            )
        )
    session.commit()
    session.refresh(transfer)
    return transfer


def create_attribute(*, session: Session, attribute_in: AttributeCreate) -> Attribute:
    """Create an attribute together with its values (blank/duplicated ignored)."""
    attribute = Attribute(name=attribute_in.name)
    session.add(attribute)
    seen: set[str] = set()
    for raw_value in attribute_in.values:
        value = raw_value.strip()
        if value and value.casefold() not in seen:
            seen.add(value.casefold())
            session.add(AttributeValue(attribute_id=attribute.id, value=value))
    session.commit()
    session.refresh(attribute)
    return attribute


def sync_attribute_values(
    *, session: Session, attribute: Attribute, values: list[str]
) -> None:
    """Replace the values of ``attribute`` so that only ``values`` remain.

    New values are created; values absent from the list are removed unless they
    are referenced by a product variant, in which case ``ValueError`` is raised.
    """
    desired = {raw.strip() for raw in values if raw.strip()}
    existing_values = {av.value: av for av in attribute.values}
    to_remove = [av for av in attribute.values if av.value not in desired]
    if to_remove:
        removable_ids = [av.id for av in to_remove]
        in_use = session.exec(
            select(ProductVariantAttribute).where(
                col(ProductVariantAttribute.attribute_value_id).in_(removable_ids)
            )
        ).first()
        if in_use:
            raise ValueError("Some attribute values are in use by product variants")
        for attribute_value in to_remove:
            session.delete(attribute_value)
    for value in desired:
        if value not in existing_values:
            session.add(AttributeValue(attribute_id=attribute.id, value=value))
    session.commit()
    session.refresh(attribute)
