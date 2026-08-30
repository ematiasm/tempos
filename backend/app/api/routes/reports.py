import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Query
from sqlmodel import col, select

from app import crud
from app.api.deps import SessionDep, require_permissions
from app.models import (
    Category,
    Document,
    DocumentLine,
    DocumentLineTax,
    DocumentOperation,
    DocumentPayment,
    DocumentStatus,
    DocumentTax,
    DocumentType,
    MarginRow,
    PaymentMethod,
    Product,
    ReorderRow,
    SalesByPaymentRow,
    SalesPerDayRow,
    SupplierProduct,
    Tax,
    VatRow,
)

router = APIRouter(prefix="/reports", tags=["reports"])


def _money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"))


def _sale_type_ids(session: SessionDep) -> set[uuid.UUID]:
    return {
        t.id
        for t in session.exec(select(DocumentType)).all()
        if t.operation == DocumentOperation.VENTA
    }


def _active_sales(
    session: SessionDep, *, desde: datetime | None, hasta: datetime | None
) -> list[Document]:
    sale_ids = _sale_type_ids(session)
    conditions: list[Any] = [
        col(Document.document_type_id).in_(sale_ids),
        col(Document.estado) == DocumentStatus.ACTIVE,
    ]
    if desde is not None:
        conditions.append(col(Document.fecha) >= desde)
    if hasta is not None:
        conditions.append(col(Document.fecha) <= hasta)
    return list(
        session.exec(
            select(Document).where(*conditions).order_by(col(Document.fecha))
        ).all()
    )


@router.get(
    "/sales-per-day",
    response_model=list[SalesPerDayRow],
    dependencies=[require_permissions("report.view")],
)
def sales_per_day(
    session: SessionDep,
    desde: date | None = Query(default=None),
    hasta: date | None = Query(default=None),
) -> Any:
    """Aggregate active sales (subtotal, discount, total) grouped by day.

    Days are business-local dates (``BusinessSettings.timezone``) and the
    ``desde``/``hasta`` bounds are inclusive local days.
    """
    dt_from, dt_to = crud.period_bounds(session, desde, hasta)
    tz = crud.business_timezone(session)
    days: dict[date, SalesPerDayRow] = {}
    for doc in _active_sales(session, desde=dt_from, hasta=dt_to):
        key = doc.fecha.astimezone(tz).date()
        row = days.get(key)
        if row is None:
            row = SalesPerDayRow(
                fecha=key,
                count=0,
                subtotal=Decimal("0"),
                descuento_total=Decimal("0"),
                total=Decimal("0"),
            )
            days[key] = row
        row.count += 1
        row.subtotal = _money(row.subtotal + doc.subtotal)
        row.descuento_total = _money(row.descuento_total + doc.descuento_total)
        row.total = _money(row.total + doc.total)
    return sorted(days.values(), key=lambda r: r.fecha)


@router.get(
    "/sales-by-payment",
    response_model=list[SalesByPaymentRow],
    dependencies=[require_permissions("report.view")],
)
def sales_by_payment(
    session: SessionDep,
    desde: date | None = Query(default=None),
    hasta: date | None = Query(default=None),
) -> Any:
    """Aggregate the payments of active sales grouped by payment method.

    Uses the same active-sale basis as sales-per-day (same inclusive
    business-local bounds), so the method rows total the period's sales
    total. Credit methods (``marks_paid`` False) appear as their own rows —
    they are included so the grand total reconciles with sales-per-day.
    """
    dt_from, dt_to = crud.period_bounds(session, desde, hasta)
    docs = _active_sales(session, desde=dt_from, hasta=dt_to)
    doc_ids = [d.id for d in docs]
    if not doc_ids:
        return []
    methods = {m.id: m for m in session.exec(select(PaymentMethod)).all()}

    agg: dict[uuid.UUID, dict[str, Any]] = {}
    for payment in session.exec(
        select(DocumentPayment).where(col(DocumentPayment.document_id).in_(doc_ids))
    ).all():
        acc = agg.setdefault(
            payment.payment_method_id, {"count": 0, "monto": Decimal("0")}
        )
        acc["count"] = int(acc["count"]) + 1
        acc["monto"] = Decimal(acc["monto"]) + payment.monto

    rows = []
    for method_id, acc in agg.items():
        method = methods.get(method_id)
        if method is None:
            continue
        rows.append(
            SalesByPaymentRow(
                method_id=method_id,
                method_name=method.name,
                marks_paid=method.marks_paid,
                count=int(acc["count"]),
                monto=_money(Decimal(acc["monto"])),
            )
        )
    rows.sort(key=lambda r: (-r.monto, r.method_name))
    return rows


@router.get(
    "/margin",
    response_model=list[MarginRow],
    dependencies=[require_permissions("report.view")],
)
def margin_report(
    session: SessionDep,
    desde: date | None = Query(default=None),
    hasta: date | None = Query(default=None),
) -> Any:
    """Gross margin per product from active sales in the date range.

    Revenue is the net-of-line-discount line subtotal; cost is the sale-time
    cost snapshot times the quantity sold. Bounds are inclusive business-local
    days.
    """
    dt_from, dt_to = crud.period_bounds(session, desde, hasta)
    docs = _active_sales(session, desde=dt_from, hasta=dt_to)
    doc_ids = [d.id for d in docs]
    if not doc_ids:
        return []
    lines = session.exec(
        select(DocumentLine).where(col(DocumentLine.document_id).in_(doc_ids))
    ).all()
    products = {
        p.id: p.name
        for p in session.exec(
            select(Product).where(col(Product.id).in_({ln.product_id for ln in lines}))
        ).all()
    }

    totals: dict[uuid.UUID, dict[str, Decimal]] = {}
    for line in lines:
        acc = totals.setdefault(
            line.product_id,
            {"units": Decimal("0"), "revenue": Decimal("0"), "cost": Decimal("0")},
        )
        acc["units"] += line.cantidad
        acc["revenue"] += line.subtotal_line
        acc["cost"] += line.cantidad * line.costo_unitario

    rows = []
    for product_id, acc in totals.items():
        revenue = _money(acc["revenue"])
        cost = _money(acc["cost"])
        margin = _money(revenue - cost)
        rows.append(
            MarginRow(
                product_id=product_id,
                name=products.get(product_id, ""),
                units=acc["units"],
                revenue=revenue,
                cost=cost,
                margin=margin,
                margin_pct=(
                    _money(margin / revenue * Decimal("100")) if revenue else None
                ),
            )
        )
    rows.sort(key=lambda m: m.margin, reverse=True)
    return rows


@router.get(
    "/vat",
    response_model=list[VatRow],
    dependencies=[require_permissions("report.view")],
)
def vat_report(
    session: SessionDep,
    desde: date | None = Query(default=None),
    hasta: date | None = Query(default=None),
) -> Any:
    """Aggregate line-level and document-level taxes on active sales.

    Bounds are inclusive business-local days.
    """
    dt_from, dt_to = crud.period_bounds(session, desde, hasta)
    docs = _active_sales(session, desde=dt_from, hasta=dt_to)
    doc_ids = [d.id for d in docs]
    if not doc_ids:
        return []
    line_ids = list(
        session.exec(
            select(col(DocumentLine.id)).where(
                col(DocumentLine.document_id).in_(doc_ids)
            )
        ).all()
    )
    taxes = {t.id: t for t in session.exec(select(Tax)).all()}

    agg: dict[uuid.UUID, dict[str, Decimal | int]] = {}
    for line_tax in session.exec(
        select(DocumentLineTax).where(
            col(DocumentLineTax.document_line_id).in_(line_ids)
        )
    ).all():
        acc = agg.setdefault(
            line_tax.tax_id,
            {"base": Decimal("0"), "monto": Decimal("0"), "count": 0},
        )
        acc["base"] = Decimal(acc["base"]) + line_tax.base
        acc["monto"] = Decimal(acc["monto"]) + line_tax.monto
        acc["count"] = int(acc["count"]) + 1
    for doc_tax in session.exec(
        select(DocumentTax).where(col(DocumentTax.document_id).in_(doc_ids))
    ).all():
        acc = agg.setdefault(
            doc_tax.tax_id,
            {"base": Decimal("0"), "monto": Decimal("0"), "count": 0},
        )
        acc["base"] = Decimal(acc["base"]) + doc_tax.base
        acc["monto"] = Decimal(acc["monto"]) + doc_tax.monto
        acc["count"] = int(acc["count"]) + 1

    rows = []
    for tax_id, acc in agg.items():
        tax = taxes.get(tax_id)
        if tax is None:
            continue
        rows.append(
            VatRow(
                tax_code=tax.code,
                tax_name=tax.name,
                tipo=tax.tipo,
                rate=tax.rate,
                is_percent=tax.is_percent,
                applies_to=tax.aplica_a,
                base=_money(Decimal(acc["base"])),
                monto=_money(Decimal(acc["monto"])),
                count=int(acc["count"]),
            )
        )
    rows.sort(key=lambda r: (r.tipo, r.tax_code))
    return rows


@router.get(
    "/reorder",
    response_model=list[ReorderRow],
    dependencies=[require_permissions("report.view")],
)
def reorder_report(
    session: SessionDep,
    supplier_id: uuid.UUID | None = Query(default=None),
    category_id: uuid.UUID | None = Query(default=None),
) -> Any:
    """Products at/below their minimum, ready to reorder.

    Optionally filtered by category and by the suppliers that offer them.
    ``missing`` is how many units to reach the minimum; ``estimated_cost``
    uses each product's reference supplier cost.
    """
    products = [
        p
        for p in session.exec(select(Product).where(Product.is_active)).all()
        if p.stock_minimo is not None and p.stock_current <= p.stock_minimo
    ]
    if category_id is not None:
        products = [p for p in products if p.category_id == category_id]
    if supplier_id is not None:
        offered = {
            sp.product_id
            for sp in session.exec(
                select(SupplierProduct).where(
                    col(SupplierProduct.supplier_id) == supplier_id
                )
            ).all()
        }
        products = [p for p in products if p.id in offered]

    category_names = _category_names(session, products)
    reference_costs = {
        sp.product_id: sp.costo_actual
        for sp in session.exec(
            select(SupplierProduct).where(
                col(SupplierProduct.es_referencia) == True  # noqa: E712
            )
        ).all()
    }

    rows = []
    for product in products:
        minimum = product.stock_minimo
        missing = (
            _money(max(minimum - product.stock_current, Decimal("0")))
            if minimum is not None
            else Decimal("0")
        )
        cost = reference_costs.get(product.id)
        rows.append(
            ReorderRow(
                id=product.id,
                name=product.name,
                sku=product.sku,
                category_id=product.category_id,
                category_name=category_names.get(product.category_id)
                if product.category_id
                else None,
                stock_current=product.stock_current,
                stock_minimo=minimum,
                stock_maximo=product.stock_maximo,
                missing=missing,
                reference_cost=cost,
                estimated_cost=_money(missing * cost) if cost and missing else None,
            )
        )
    return rows


def _category_names(
    session: SessionDep, products: list[Product]
) -> dict[uuid.UUID | None, str]:
    ids = {p.category_id for p in products if p.category_id}
    names: dict[uuid.UUID | None, str] = {
        c.id: c.name
        for c in session.exec(select(Category).where(col(Category.id).in_(ids))).all()
    }
    return names
