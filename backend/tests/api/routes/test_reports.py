"""Tests for the /reports endpoints."""

from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.models import PaymentMethod
from tests.utils.ledger import load_stock
from tests.utils.utils import random_lower_string


def _create_financial_account(client: TestClient, headers: dict[str, str]) -> dict:
    r = client.post(
        f"{settings.API_V1_STR}/financial-accounts/",
        headers=headers,
        json={"name": random_lower_string()[:15]},
    )
    assert r.status_code == 200, r.text
    return r.json()


def _create_card_method(
    client: TestClient, headers: dict[str, str], account_id: str
) -> dict:
    r = client.post(
        f"{settings.API_V1_STR}/payment-methods/",
        headers=headers,
        json={"name": "Tarjeta", "financial_account_id": account_id},
    )
    assert r.status_code == 200, r.text
    return r.json()


def _credit_method_id(db: Session) -> str:
    method = db.exec(
        select(PaymentMethod).where(PaymentMethod.marks_paid == False)  # noqa: E712
    ).first()
    assert method is not None, "Seeded credit payment method not found"
    return str(method.id)


def _create_uom(client: TestClient, headers: dict[str, str]) -> dict:
    r = client.post(
        f"{settings.API_V1_STR}/uoms/",
        headers=headers,
        json={
            "name": random_lower_string()[:10],
            "abbreviation": random_lower_string()[:3].upper(),
            "decimal_places": 0,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def _create_product(
    client: TestClient,
    headers: dict[str, str],
    *,
    costo: str = "100.00",
    margen: str = "21.00",
    stock_minimo: str | None = None,
    tax_ids: list[str] | None = None,
    is_active: bool = True,
) -> dict:
    uom = _create_uom(client, headers)
    payload: dict = {
        "name": random_lower_string()[:20],
        "uom_id": uom["id"],
        "margen_pct": margen,
        "costo_actual": costo,
        "tax_ids": tax_ids or [],
        "is_active": is_active,
    }
    if stock_minimo is not None:
        payload["stock_minimo"] = stock_minimo
    r = client.post(
        f"{settings.API_V1_STR}/products/",
        headers=headers,
        json=payload,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _create_customer(
    client: TestClient, headers: dict[str, str], condicion: str = "RI"
) -> dict:
    r = client.post(
        f"{settings.API_V1_STR}/customers/",
        headers=headers,
        json={
            "razon_social": random_lower_string()[:20],
            "condicion_fiscal": condicion,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def _doc_type_id(client: TestClient, headers: dict[str, str], prefix: str) -> str:
    r = client.get(
        f"{settings.API_V1_STR}/document-types/",
        headers=headers,
        params={"limit": 100},
    )
    assert r.status_code == 200
    return next(row for row in r.json()["data"] if row["prefix"] == prefix)["id"]


def _cash_method_id(db: Session) -> str:
    method = db.exec(
        select(PaymentMethod).where(PaymentMethod.name == "Efectivo")
    ).first()
    assert method is not None, "Seeded cash payment method not found"
    return str(method.id)


def _set_timezone(
    client: TestClient, headers: dict[str, str], value: str | None
) -> None:
    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=headers,
        json={"timezone": value},
    )
    assert r.status_code == 200, r.text


def _create_sale(
    client: TestClient,
    headers: dict[str, str],
    product_id: str,
    customer_id: str,
    method_id: str,
    *,
    cantidad: str = "2",
    precio_unit: str | None = None,
    fecha: str | None = None,
) -> dict:
    payload: dict = {
        "document_type_id": _doc_type_id(client, headers, "TCK"),
        "contraparte_id": customer_id,
        "lines": [{"product_id": product_id, "cantidad": cantidad}],
    }
    if precio_unit is not None:
        payload["lines"][0]["precio_unit"] = precio_unit
    if fecha is not None:
        payload["fecha"] = fecha
    total = str(Decimal(cantidad) * Decimal(precio_unit or "121.00"))
    payload["payments"] = [{"payment_method_id": method_id, "monto": total}]
    r = client.post(f"{settings.API_V1_STR}/documents/", headers=headers, json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def test_sales_per_day_aggregates_by_date(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "10")
    method = _cash_method_id(db)

    # Midday-UTC fechas: they map to the same business-local day under both
    # the seeded AR timezone and the UTC fallback.
    _create_sale(
        client,
        superuser_token_headers,
        product["id"],
        customer["id"],
        method,
        fecha="2024-06-05T12:00:00Z",
    )
    _create_sale(
        client,
        superuser_token_headers,
        product["id"],
        customer["id"],
        method,
        fecha="2024-06-05T12:00:00Z",
    )
    _create_sale(
        client,
        superuser_token_headers,
        product["id"],
        customer["id"],
        method,
        fecha="2024-06-06T12:00:00Z",
    )

    r = client.get(
        f"{settings.API_V1_STR}/reports/sales-per-day/", headers=superuser_token_headers
    )
    assert r.status_code == 200, r.text
    rows = {row["fecha"]: row for row in r.json()}
    assert rows["2024-06-05"]["count"] == 2
    assert rows["2024-06-05"]["subtotal"] == "484.00"
    assert rows["2024-06-05"]["total"] == "484.00"
    assert rows["2024-06-06"]["count"] == 1
    assert rows["2024-06-06"]["total"] == "242.00"


def test_sales_per_day_filters_by_date_range(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "5")
    method = _cash_method_id(db)

    # Midday-UTC fechas: under the business-local day bounds each sale stays
    # on the asserted local date under both the AR timezone and UTC.
    _create_sale(
        client,
        superuser_token_headers,
        product["id"],
        customer["id"],
        method,
        fecha="2024-02-10T12:00:00Z",
    )
    _create_sale(
        client,
        superuser_token_headers,
        product["id"],
        customer["id"],
        method,
        fecha="2024-03-15T12:00:00Z",
    )

    r = client.get(
        f"{settings.API_V1_STR}/reports/sales-per-day/",
        headers=superuser_token_headers,
        params={"desde": "2024-02-01", "hasta": "2024-03-01"},
    )
    assert r.status_code == 200, r.text
    dates = [row["fecha"] for row in r.json()]
    assert dates == ["2024-02-10"]


def test_sales_per_day_groups_by_business_timezone_with_inclusive_bounds(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "10")
    method = _cash_method_id(db)

    previous_tz = client.get(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
    ).json()["timezone"]
    _set_timezone(client, superuser_token_headers, "America/Argentina/Buenos_Aires")
    try:
        # 22:05 and 23:30 business-local on 2026-08-29 (UTC-3): their UTC
        # timestamps fall on 2026-08-30, yet they belong to the queried local
        # day. The third sale is 12:00 local on 2026-08-30: outside the range.
        _create_sale(
            client,
            superuser_token_headers,
            product["id"],
            customer["id"],
            method,
            fecha="2026-08-30T01:05:00Z",
        )
        _create_sale(
            client,
            superuser_token_headers,
            product["id"],
            customer["id"],
            method,
            fecha="2026-08-30T02:30:00Z",
        )
        _create_sale(
            client,
            superuser_token_headers,
            product["id"],
            customer["id"],
            method,
            fecha="2026-08-30T15:00:00Z",
        )

        r = client.get(
            f"{settings.API_V1_STR}/reports/sales-per-day/",
            headers=superuser_token_headers,
            params={"desde": "2026-08-29", "hasta": "2026-08-29"},
        )
        assert r.status_code == 200, r.text
        rows = r.json()
        assert [row["fecha"] for row in rows] == ["2026-08-29"]
        assert rows[0]["count"] == 2
        assert rows[0]["total"] == "484.00"
    finally:
        _set_timezone(client, superuser_token_headers, previous_tz)


def _create_sale_with_payments(
    client: TestClient,
    headers: dict[str, str],
    product_id: str,
    customer_id: str,
    payments: list[dict[str, str]],
    *,
    cantidad: str = "2",
    precio_unit: str | None = None,
    fecha: str | None = None,
) -> dict:
    payload: dict = {
        "document_type_id": _doc_type_id(client, headers, "TCK"),
        "contraparte_id": customer_id,
        "lines": [{"product_id": product_id, "cantidad": cantidad}],
        "payments": payments,
    }
    if precio_unit is not None:
        payload["lines"][0]["precio_unit"] = precio_unit
    if fecha is not None:
        payload["fecha"] = fecha
    r = client.post(f"{settings.API_V1_STR}/documents/", headers=headers, json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def _void_document(
    client: TestClient, headers: dict[str, str], document_id: str
) -> dict:
    r = client.post(
        f"{settings.API_V1_STR}/documents/{document_id}/void",
        headers=headers,
        json={},
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_sales_by_payment_groups_by_method_and_reconciles(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "10")
    cash_id = _cash_method_id(db)
    credit_id = _credit_method_id(db)
    bank = _create_financial_account(client, superuser_token_headers)
    card = _create_card_method(client, superuser_token_headers, bank["id"])

    # Sale 1 (242.00): cash 200 + credit 42 (a marks_paid=False method row).
    sale1 = _create_sale_with_payments(
        client,
        superuser_token_headers,
        product["id"],
        customer["id"],
        [
            {"payment_method_id": cash_id, "monto": "200.00"},
            {"payment_method_id": credit_id, "monto": "42.00"},
        ],
        fecha="2024-06-05T12:00:00Z",
    )
    assert Decimal(sale1["total"]) == Decimal("242.00")
    # Sale 2 (363.00): fully paid by card.
    _create_sale_with_payments(
        client,
        superuser_token_headers,
        product["id"],
        customer["id"],
        [{"payment_method_id": card["id"], "monto": "363.00"}],
        cantidad="3",
        fecha="2024-06-06T12:00:00Z",
    )
    # Sale 3 (121.00): cash, then fully voided — its payment rows must be
    # excluded from the report (the mirror NC's payment is dated outside the
    # queried range, so it does not mask the exclusion either).
    sale3 = _create_sale_with_payments(
        client,
        superuser_token_headers,
        product["id"],
        customer["id"],
        [{"payment_method_id": cash_id, "monto": "121.00"}],
        cantidad="1",
        fecha="2024-06-07T12:00:00Z",
    )
    _void_document(client, superuser_token_headers, sale3["id"])

    r = client.get(
        f"{settings.API_V1_STR}/reports/sales-by-payment/",
        headers=superuser_token_headers,
        params={"desde": "2024-06-01", "hasta": "2024-06-30"},
    )
    assert r.status_code == 200, r.text
    rows = {row["method_name"]: row for row in r.json()}

    def method_row(name: str) -> dict:
        row = rows[name]
        return {
            "method_name": row["method_name"],
            "marks_paid": row["marks_paid"],
            "count": row["count"],
            "monto": row["monto"],
        }

    # Cash: sale 1's 200.00; sale 3's 121.00 is excluded (voided document).
    assert method_row("Efectivo") == {
        "method_name": "Efectivo",
        "marks_paid": True,
        "count": 1,
        "monto": "200.00",
    }
    assert method_row("Tarjeta") == {
        "method_name": "Tarjeta",
        "marks_paid": True,
        "count": 1,
        "monto": "363.00",
    }
    assert method_row("Crédito") == {
        "method_name": "Crédito",
        "marks_paid": False,
        "count": 1,
        "monto": "42.00",
    }
    payment_total = sum(Decimal(row["monto"]) for row in rows.values())
    assert payment_total == Decimal("605.00")

    # The method rows total the same period's sales total (sales-per-day).
    r = client.get(
        f"{settings.API_V1_STR}/reports/sales-per-day/",
        headers=superuser_token_headers,
        params={"desde": "2024-06-01", "hasta": "2024-06-30"},
    )
    assert r.status_code == 200, r.text
    sales_total = sum(Decimal(row["total"]) for row in r.json())
    assert sales_total == payment_total == Decimal("605.00")


def test_account_movements_filter_by_business_local_days(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "5")
    method = _cash_method_id(db)

    previous_tz = client.get(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
    ).json()["timezone"]
    _set_timezone(client, superuser_token_headers, "America/Argentina/Buenos_Aires")
    try:
        # 22:05 business-local on 2026-08-29; the cash sale's account movement
        # inherits the document fecha.
        sale = _create_sale(
            client,
            superuser_token_headers,
            product["id"],
            customer["id"],
            method,
            fecha="2026-08-30T01:05:00Z",
        )

        r = client.get(
            f"{settings.API_V1_STR}/account-movements/",
            headers=superuser_token_headers,
            params={
                "fecha_desde": "2026-08-29",
                "fecha_hasta": "2026-08-29",
                "limit": 500,
            },
        )
        assert r.status_code == 200, r.text
        numeros = [row["document_numero"] for row in r.json()["data"]]
        assert sale["numero"] in numeros

        # Its UTC timestamp falls on 2026-08-30, but that is not its local day.
        r = client.get(
            f"{settings.API_V1_STR}/account-movements/",
            headers=superuser_token_headers,
            params={
                "fecha_desde": "2026-08-30",
                "fecha_hasta": "2026-08-30",
                "limit": 500,
            },
        )
        assert r.status_code == 200, r.text
        numeros = [row["document_numero"] for row in r.json()["data"]]
        assert sale["numero"] not in numeros
    finally:
        _set_timezone(client, superuser_token_headers, previous_tz)


def test_margin_report_uses_cost_snapshot(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "5")
    method = _cash_method_id(db)

    _create_sale(
        client,
        superuser_token_headers,
        product["id"],
        customer["id"],
        method,
        cantidad="3",
        precio_unit="150.00",
    )

    r = client.get(
        f"{settings.API_V1_STR}/reports/margin/", headers=superuser_token_headers
    )
    assert r.status_code == 200, r.text
    rows = [row for row in r.json() if row["product_id"] == product["id"]]
    assert len(rows) == 1
    row = rows[0]
    assert Decimal(row["units"]) == Decimal("3")
    assert row["revenue"] == "450.00"  # 3 * 150.00
    assert row["cost"] == "300.00"  # 3 * 100.00 snapshot
    assert row["margin"] == "150.00"
    assert row["margin_pct"] == "33.33"


def test_vat_report_aggregates_line_and_document_taxes(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    payload = {
        "name": random_lower_string(),
        "code": random_lower_string()[:8].upper(),
        "tipo": "IIBB",
        "rate": "5.00",
        "is_percent": True,
        "aplica_a": "linea",
        "is_active": True,
    }
    r = client.post(
        f"{settings.API_V1_STR}/taxes/", headers=superuser_token_headers, json=payload
    )
    assert r.status_code == 200, r.text
    custom_tax = r.json()

    customer = _create_customer(client, superuser_token_headers)
    product = _create_product(
        client, superuser_token_headers, tax_ids=[custom_tax["id"]]
    )
    load_stock(client, superuser_token_headers, product["id"], "5")
    method = _cash_method_id(db)
    _create_sale(client, superuser_token_headers, product["id"], customer["id"], method)

    r = client.get(
        f"{settings.API_V1_STR}/reports/vat/", headers=superuser_token_headers
    )
    assert r.status_code == 200, r.text
    row = next(row for row in r.json() if row["tax_code"] == custom_tax["code"])
    assert row["count"] == 1
    assert row["base"] == "242.00"
    assert row["monto"] == "12.10"  # 242 * 0.05


def test_reorder_includes_only_products_with_minimum_below(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    product = _create_product(client, superuser_token_headers, stock_minimo="10")
    no_minimum = _create_product(client, superuser_token_headers)

    r = client.get(
        f"{settings.API_V1_STR}/reports/reorder/", headers=superuser_token_headers
    )
    assert r.status_code == 200, r.text
    ids = {row["id"] for row in r.json()}
    assert product["id"] in ids  # 0 stock <= 10 minimum
    assert no_minimum["id"] not in ids  # no minimum -> never reorder
