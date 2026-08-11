"""Tests for the /reports endpoints."""

from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.models import PaymentMethod
from tests.utils.ledger import load_stock
from tests.utils.utils import random_lower_string


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

    _create_sale(
        client,
        superuser_token_headers,
        product["id"],
        customer["id"],
        method,
        fecha="2024-06-05",
    )
    _create_sale(
        client,
        superuser_token_headers,
        product["id"],
        customer["id"],
        method,
        fecha="2024-06-05",
    )
    _create_sale(
        client,
        superuser_token_headers,
        product["id"],
        customer["id"],
        method,
        fecha="2024-06-06",
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

    _create_sale(
        client,
        superuser_token_headers,
        product["id"],
        customer["id"],
        method,
        fecha="2024-02-10",
    )
    _create_sale(
        client,
        superuser_token_headers,
        product["id"],
        customer["id"],
        method,
        fecha="2024-03-15",
    )

    r = client.get(
        f"{settings.API_V1_STR}/reports/sales-per-day/",
        headers=superuser_token_headers,
        params={"desde": "2024-02-01", "hasta": "2024-03-01"},
    )
    assert r.status_code == 200, r.text
    dates = [row["fecha"] for row in r.json()]
    assert dates == ["2024-02-10"]


def test_low_stock_lists_active_products_below_minimum(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    below_min = _create_product(client, superuser_token_headers, stock_minimo="10")
    active_no_stock = _create_product(client, superuser_token_headers)
    inactive = _create_product(
        client, superuser_token_headers, stock_minimo="10", is_active=False
    )

    r = client.get(
        f"{settings.API_V1_STR}/reports/low-stock/", headers=superuser_token_headers
    )
    assert r.status_code == 200, r.text
    ids = {row["id"] for row in r.json()}
    assert below_min["id"] in ids  # 0 stock == 0 <= 10
    assert active_no_stock["id"] in ids  # 0 stock always flagged
    assert inactive["id"] not in ids  # inactive filtered out


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
