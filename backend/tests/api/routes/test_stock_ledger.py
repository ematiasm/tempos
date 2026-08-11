"""Tests for the stock ledger: /stock-movements and product stock deltas."""

from decimal import Decimal

from fastapi.testclient import TestClient

from app.core.config import settings
from tests.utils.ledger import load_stock, unload_stock
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
    client: TestClient, headers: dict[str, str], tax_ids: list[str] | None = None
) -> dict:
    uom = _create_uom(client, headers)
    r = client.post(
        f"{settings.API_V1_STR}/products/",
        headers=headers,
        json={
            "name": random_lower_string()[:20],
            "uom_id": uom["id"],
            "margen_pct": "21.00",
            "costo_actual": "100.00",
            "tax_ids": tax_ids or [],
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def _create_customer(client: TestClient, headers: dict[str, str]) -> dict:
    r = client.post(
        f"{settings.API_V1_STR}/customers/",
        headers=headers,
        json={"razon_social": random_lower_string()[:20], "condicion_fiscal": "RI"},
    )
    assert r.status_code == 200, r.text
    return r.json()


def _create_supplier(client: TestClient, headers: dict[str, str]) -> dict:
    r = client.post(
        f"{settings.API_V1_STR}/suppliers/",
        headers=headers,
        json={"razon_social": random_lower_string()[:20]},
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


def _create_doc(client: TestClient, headers: dict[str, str], payload: dict) -> dict:
    r = client.post(f"{settings.API_V1_STR}/documents/", headers=headers, json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def _stock(client: TestClient, headers: dict[str, str], product_id: str) -> Decimal:
    r = client.get(f"{settings.API_V1_STR}/products/{product_id}", headers=headers)
    assert r.status_code == 200, r.text
    return Decimal(r.json()["stock_current"])


def _stock_movements(client: TestClient, headers: dict[str, str], **params) -> list:
    r = client.get(
        f"{settings.API_V1_STR}/stock-movements/",
        headers=headers,
        params=params,
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_stock_adjustment_moves_product_stock(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    product = _create_product(client, superuser_token_headers)
    assert _stock(client, superuser_token_headers, product["id"]) == Decimal("0")

    load_stock(client, superuser_token_headers, product["id"], "10")
    assert _stock(client, superuser_token_headers, product["id"]) == Decimal("10")

    unload_stock(client, superuser_token_headers, product["id"], "3")
    assert _stock(client, superuser_token_headers, product["id"]) == Decimal("7")


def test_sale_deducts_stock_and_records_movements(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "5")
    customer = _create_customer(client, superuser_token_headers)
    tck = _doc_type_id(client, superuser_token_headers, "TCK")
    doc = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "2"}],
        },
    )
    assert _stock(client, superuser_token_headers, product["id"]) == Decimal("3")

    page = _stock_movements(
        client, superuser_token_headers, product_id=product["id"], limit=100
    )
    assert page["count"] == 2
    sale_mov = next(m for m in page["data"] if m["document_id"] == doc["id"])
    assert sale_mov["cantidad"] == "-2.000"
    assert sale_mov["signo"] == -1
    assert sale_mov["motivo"] == "Ticket"
    assert sale_mov["product_name"] == product["name"]
    assert sale_mov["document_numero"] == doc["numero"]
    assert sale_mov["variant_id"] is None

    # product filter
    page = _stock_movements(
        client, superuser_token_headers, product_id=product["id"], limit=100
    )
    assert page["count"] == 2
    # document filter
    page = _stock_movements(
        client, superuser_token_headers, document_id=doc["id"], limit=100
    )
    assert page["count"] == 1


def test_purchase_adds_stock(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    product = _create_product(client, superuser_token_headers)
    supplier = _create_supplier(client, superuser_token_headers)
    oc = _doc_type_id(client, superuser_token_headers, "OC")
    doc = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": oc,
            "contraparte_id": supplier["id"],
            "lines": [{"product_id": product["id"], "cantidad": "3"}],
        },
    )
    assert _stock(client, superuser_token_headers, product["id"]) == Decimal("3")
    page = _stock_movements(client, superuser_token_headers, limit=100)
    mov = next(m for m in page["data"] if m["document_id"] == doc["id"])
    assert mov["cantidad"] == "3.000"
    assert mov["signo"] == 1
    assert mov["motivo"] == "Orden de Compra"


def test_quote_does_not_touch_stock(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    product = _create_product(client, superuser_token_headers)
    customer = _create_customer(client, superuser_token_headers)
    cot = _doc_type_id(client, superuser_token_headers, "COT")
    _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": cot,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],
        },
    )
    assert _stock(client, superuser_token_headers, product["id"]) == Decimal("0")
    assert (
        _stock_movements(
            client, superuser_token_headers, product_id=product["id"], limit=100
        )["count"]
        == 0
    )


def test_negative_stock_blocked_by_default(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    product = _create_product(client, superuser_token_headers)
    customer = _create_customer(client, superuser_token_headers)
    tck = _doc_type_id(client, superuser_token_headers, "TCK")
    r = client.post(
        f"{settings.API_V1_STR}/documents/",
        headers=superuser_token_headers,
        json={
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],
        },
    )
    assert r.status_code == 400
    assert "Insufficient stock" in r.json()["detail"]["message"]
    assert _stock(client, superuser_token_headers, product["id"]) == Decimal("0")
    # no ledger row was written for the rejected sale
    assert (
        _stock_movements(
            client, superuser_token_headers, product_id=product["id"], limit=100
        )["count"]
        == 0
    )


def test_partial_stock_shortage_rejected(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "3")
    customer = _create_customer(client, superuser_token_headers)
    tck = _doc_type_id(client, superuser_token_headers, "TCK")
    r = client.post(
        f"{settings.API_V1_STR}/documents/",
        headers=superuser_token_headers,
        json={
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "5"}],
        },
    )
    assert r.status_code == 400
    assert "Insufficient stock" in r.json()["detail"]["message"]
    assert _stock(client, superuser_token_headers, product["id"]) == Decimal("3")


def test_negative_stock_allowed_when_enabled(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    settings_url = f"{settings.API_V1_STR}/business-settings/"
    product = _create_product(client, superuser_token_headers)
    customer = _create_customer(client, superuser_token_headers)
    tck = _doc_type_id(client, superuser_token_headers, "TCK")
    r = client.patch(
        settings_url,
        headers=superuser_token_headers,
        json={"allow_negative_stock": True},
    )
    assert r.status_code == 200, r.text
    try:
        _create_doc(
            client,
            superuser_token_headers,
            {
                "document_type_id": tck,
                "contraparte_id": customer["id"],
                "lines": [{"product_id": product["id"], "cantidad": "1"}],
            },
        )
        assert _stock(client, superuser_token_headers, product["id"]) == Decimal("-1")
    finally:
        r = client.patch(
            settings_url,
            headers=superuser_token_headers,
            json={"allow_negative_stock": False},
        )
        assert r.status_code == 200


def test_variant_line_moves_only_variant_stock(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    product = _create_product(client, superuser_token_headers)
    r = client.post(
        f"{settings.API_V1_STR}/products/{product['id']}/variants",
        headers=superuser_token_headers,
        json={"product_id": product["id"], "sku_suffix": "RED"},
    )
    assert r.status_code == 200, r.text
    variant = r.json()
    vid = variant["id"]

    # stock the variant through an adjustment with variant_id
    ajs = _doc_type_id(client, superuser_token_headers, "AJS")
    _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": ajs,
            "lines": [
                {"product_id": product["id"], "variant_id": vid, "cantidad": "5"}
            ],
        },
    )

    customer = _create_customer(client, superuser_token_headers)
    tck = _doc_type_id(client, superuser_token_headers, "TCK")
    _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "lines": [
                {"product_id": product["id"], "variant_id": vid, "cantidad": "2"}
            ],
        },
    )

    # only the variant moved; the base product stock is untouched
    r = client.get(
        f"{settings.API_V1_STR}/products/{product['id']}",
        headers=superuser_token_headers,
    )
    body = r.json()
    assert body["stock_current"] == "0.000"
    variant_row = next(v for v in body["variants"] if v["id"] == vid)
    assert variant_row["stock_current"] == "3.000"

    page = _stock_movements(
        client, superuser_token_headers, product_id=product["id"], limit=100
    )
    for mov in page["data"]:
        assert mov["variant_id"] == vid


def test_sale_without_stock_on_void_returns_stock(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "2")
    customer = _create_customer(client, superuser_token_headers)
    tck = _doc_type_id(client, superuser_token_headers, "TCK")
    doc = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "2"}],
        },
    )
    assert _stock(client, superuser_token_headers, product["id"]) == Decimal("0")

    r = client.post(
        f"{settings.API_V1_STR}/documents/{doc['id']}/void",
        headers=superuser_token_headers,
        json={"lines": [], "payments": []},
    )
    assert r.status_code == 200, r.text
    # the NC returned the stock
    assert _stock(client, superuser_token_headers, product["id"]) == Decimal("2")
    page = _stock_movements(
        client, superuser_token_headers, product_id=product["id"], limit=100
    )
    assert page["count"] == 3  # AJS +, sale -, NC +
