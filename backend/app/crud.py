import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, delete, select

from app.core.security import get_password_hash, verify_password
from app.models import (
    Attribute,
    AttributeCreate,
    AttributeValue,
    CounterpartType,
    Customer,
    Document,
    DocumentCreate,
    DocumentLine,
    DocumentLineTax,
    DocumentOperation,
    DocumentPayment,
    DocumentSequence,
    DocumentTax,
    DocumentType,
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
    """Create a document with lines, taxes and payments in one transaction.

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
                product.costo_actual,
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

    session.commit()
    session.refresh(document)
    return document


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
