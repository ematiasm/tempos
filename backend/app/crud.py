import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload
from sqlmodel import Session, col, delete, func, select

from app.core.security import get_password_hash, verify_password
from app.models import (
    FISCAL_SALE_TYPE_NAMES,
    Attribute,
    AttributeCreate,
    AttributeValue,
    BusinessSettings,
    CounterpartType,
    Customer,
    Document,
    DocumentCreate,
    DocumentLine,
    DocumentLineCreate,
    DocumentLineTax,
    DocumentOperation,
    DocumentPayment,
    DocumentSequence,
    DocumentStatus,
    DocumentTax,
    DocumentType,
    DocumentVoidCreate,
    Item,
    ItemCreate,
    PaymentMethod,
    Product,
    ProductCreate,
    ProductTax,
    ProductUpdate,
    ProductVariant,
    ProductVariantAttribute,
    Role,
    Supplier,
    TaxAppliesTo,
    TaxCondition,
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
) -> Document:
    """Create a document with lines, taxes and payments in one transaction."""
    document = _create_document_in_tx(
        session=session, document_in=document_in, user_id=user_id
    )
    session.commit()
    session.refresh(document)
    return document


def _create_document_in_tx(
    *,
    session: Session,
    document_in: DocumentCreate,
    user_id: uuid.UUID,
    parent_document_id: uuid.UUID | None = None,
    parent_line_ids: dict[int, uuid.UUID] | None = None,
) -> Document:
    """Transactional core of document creation (no commit/refresh).

    Prices carry IVA inside (retail convention): line-tax rows are an
    informational breakdown and never change the total; only document-level
    taxes (percepciones) add on top. Raises ValueError on business-rule
    violations (the route layer turns it into a 400).
    """
    doc_type = session.get(DocumentType, document_in.document_type_id)
    if not doc_type or not doc_type.is_active:
        raise ValueError("Document type not found")

    if doc_type.tipo_contraparte is None:
        if document_in.contraparte_id is not None:
            raise ValueError("This document type does not take a counterpart")
    else:
        if document_in.contraparte_id is None:
            raise ValueError("This document type requires a counterpart")
        counterpart: Customer | Supplier | None
        if doc_type.tipo_contraparte == CounterpartType.CUSTOMER:
            counterpart = session.get(Customer, document_in.contraparte_id)
        else:
            counterpart = session.get(Supplier, document_in.contraparte_id)
        if not counterpart:
            raise ValueError("Counterpart not found")
        if not counterpart.is_active:
            raise ValueError("The counterpart is inactive")

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
    for index, line_in in enumerate(document_in.lines, start=1):
        product = session.get(Product, line_in.product_id)
        if not product:
            raise ValueError(f"Product not found: {line_in.product_id}")
        if line_in.variant_id is not None:
            variant = session.get(ProductVariant, line_in.variant_id)
            if not variant or variant.product_id != product.id:
                raise ValueError("Variant not found in this product")
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
        descuento_monto = (
            _money(line_in.descuento_monto)
            if line_in.descuento_monto is not None
            else _money(bruto * line_in.descuento_pct / Decimal("100"))
        )
        if descuento_monto > bruto:
            raise ValueError("Line discount exceeds the line amount")
        subtotal_line = bruto - descuento_monto

        if line_in.tax_ids is None:
            taxes = list(product.taxes)
        else:
            wanted = set(line_in.tax_ids)
            available = {t.id: t for t in product.taxes}
            missing = wanted - available.keys()
            if missing:
                raise ValueError(
                    f"Taxes not assigned to product {product.name}: {missing}"
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

    if document_in.descuento_total > subtotal:
        raise ValueError("Document discount exceeds the subtotal")

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
            raise ValueError(
                f"Payment method not found: {payment_in.payment_method_id}"
            )

    document = Document(
        document_type_id=doc_type.id,
        numero=numero,
        year=year,
        fecha=fecha,
        contraparte_type=doc_type.tipo_contraparte,
        contraparte_id=document_in.contraparte_id,
        user_id=user_id,
        subtotal=subtotal,
        descuento_total=document_in.descuento_total,
        total=subtotal - document_in.descuento_total + doc_taxes_total,
        parent_document_id=parent_document_id,
    )
    session.add(document)
    session.flush()

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
    _purchase_cost_hook(session=session, document=document)  # Phase 5
    _stock_movements_hook(session=session, document=document)  # Phase 6
    _financial_movements_hook(session=session, document=document)  # Phase 7

    return document


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
            selectinload(Document.lines).selectinload(DocumentLine.taxes),  # type: ignore
            selectinload(Document.taxes),  # type: ignore
        )
    ).first()
    if not original:
        raise ValueError("Document not found")
    if original.estado == DocumentStatus.VOIDED:
        raise ValueError("Document is already voided")
    original_type = original.document_type
    if original_type is None:
        raise ValueError("Document has no document type")
    nc_type_id = original_type.void_document_type_id
    if nc_type_id is None:
        raise ValueError(f"Documents of type '{original_type.name}' are not voidable")

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
                raise ValueError("A void line does not belong to the document")
            if remaining[void_line.document_line_id] <= 0:
                raise ValueError("A void line has nothing left to void")
            acc = requested.get(void_line.document_line_id, Decimal("0"))
            requested[void_line.document_line_id] = acc + void_line.cantidad
    else:
        requested = {line_id: qty for line_id, qty in remaining.items() if qty > 0}
    if not requested:
        raise ValueError("Nothing left to void")
    for line_id, qty in requested.items():
        if qty > remaining[line_id]:
            raise ValueError(
                f"Void quantity ({qty}) exceeds what is left "
                f"({remaining[line_id]}) for a line"
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

    nc_in = DocumentCreate(
        document_type_id=nc_type_id,
        contraparte_id=original.contraparte_id,
        descuento_total=original.descuento_total if becomes_voided else Decimal("0"),
        lines=nc_lines,
        payments=void_in.payments,
    )
    nc = _create_document_in_tx(
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
        raise ValueError("Customer not found")
    settings = session.exec(select(BusinessSettings)).first()
    if not settings:
        raise ValueError("Business settings not found")
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
        raise ValueError("Document not found")
    if quote.document_type is None or quote.document_type.operation != (
        DocumentOperation.COTIZACION
    ):
        raise ValueError("Only quotes can be converted to invoices")
    if quote.estado == DocumentStatus.VOIDED:
        raise ValueError("A voided quote cannot be converted")
    if quote.contraparte_id is None:
        raise ValueError("The quote has no customer")
    existing = session.exec(
        select(Document).where(
            col(Document.parent_document_id) == quote.id,
            Document.estado == DocumentStatus.ACTIVE,
        )
    ).first()
    if existing:
        raise ValueError(f"Quote already converted (invoice {existing.numero})")

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
    invoice = _create_document_in_tx(
        session=session,
        document_in=invoice_in,
        user_id=user_id,
        parent_document_id=quote.id,
        parent_line_ids=parent_line_ids,
    )
    session.commit()
    session.refresh(invoice)
    return invoice


def _purchase_cost_hook(*, session: Session, document: Document) -> None:
    """Phase 5: update SupplierProduct costs on purchase documents."""


def _stock_movements_hook(*, session: Session, document: Document) -> None:
    """Phase 6: emit StockMovement rows and reconcile product stock caches."""


def _financial_movements_hook(*, session: Session, document: Document) -> None:
    """Phase 7: emit AccountMovement + current-account ledger rows."""


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
