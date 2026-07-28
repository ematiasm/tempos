"""Tests for quote → invoice conversion: POST /documents/{id}/convert-to-invoice."""

from fastapi.testclient import TestClient

from app.core.config import settings
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
    return next(row for row in r.json()["data"] if row["prefix"] == prefix)["id"]


def _iva21_id(client: TestClient, headers: dict[str, str]) -> str:
    r = client.get(f"{settings.API_V1_STR}/taxes/", headers=headers)
    return next(row for row in r.json()["data"] if row["code"] == "IVA21")["id"]


def _create_doc(client: TestClient, headers: dict[str, str], payload: dict) -> dict:
    r = client.post(f"{settings.API_V1_STR}/documents/", headers=headers, json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def _convert(client: TestClient, headers: dict[str, str], doc_id: str):
    return client.post(
        f"{settings.API_V1_STR}/documents/{doc_id}/convert-to-invoice",
        headers=headers,
        json={},
    )


def _make_quote(client: TestClient, headers: dict[str, str]) -> dict:
    customer = _create_customer(client, headers)
    iva21 = _iva21_id(client, headers)
    product = _create_product(client, headers, [iva21])
    cot = _doc_type_id(client, headers, "COT")
    return _create_doc(
        client,
        headers,
        {
            "document_type_id": cot,
            "contraparte_id": customer["id"],
            "descuento_total": "10.00",
            "lines": [
                {
                    "product_id": product["id"],
                    "cantidad": "2",
                    "descuento_pct": "10",
                },
                {
                    "product_id": product["id"],
                    "cantidad": "1",
                    "precio_unit": "100.00",
                    "descuento_monto": "10.00",
                },
            ],
        },
    )


def test_convert_quote_to_invoice_exact_copy(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={"condicion_fiscal": "RI"},
    )
    quote = _make_quote(client, superuser_token_headers)

    r = _convert(client, superuser_token_headers, quote["id"])
    assert r.status_code == 200, r.text
    invoice = r.json()

    # RI business + RI customer → Factura A
    assert invoice["document_type"]["name"] == "Factura A"
    assert invoice["parent_document_id"] == quote["id"]
    assert invoice["contraparte_id"] == quote["contraparte_id"]
    # exact copy
    assert invoice["subtotal"] == quote["subtotal"]
    assert invoice["descuento_total"] == quote["descuento_total"]
    assert invoice["total"] == quote["total"]
    assert len(invoice["lines"]) == 2
    assert invoice["payments"] == []
    invoice_costs = sorted(line["costo_unitario"] for line in invoice["lines"])
    quote_costs = sorted(line["costo_unitario"] for line in quote["lines"])
    assert invoice_costs == quote_costs

    # the quote stays active, linked, and cannot be converted again
    r = client.get(
        f"{settings.API_V1_STR}/documents/{quote['id']}",
        headers=superuser_token_headers,
    )
    reloaded_quote = r.json()
    assert reloaded_quote["estado"] == "active"
    assert reloaded_quote["child_document_id"] == invoice["id"]
    assert reloaded_quote["child_document_numero"] == invoice["numero"]

    r = _convert(client, superuser_token_headers, quote["id"])
    assert r.status_code == 400
    assert "already converted" in r.json()["detail"]

    # restore seeded business condition
    client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={"condicion_fiscal": "Consumidor Final"},
    )


def test_reconvert_after_invoice_is_voided(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    quote = _make_quote(client, superuser_token_headers)
    invoice = _convert(client, superuser_token_headers, quote["id"]).json()

    # voiding the invoice unlocks the quote for a new conversion
    r = client.post(
        f"{settings.API_V1_STR}/documents/{invoice['id']}/void",
        headers=superuser_token_headers,
        json={"lines": [], "payments": []},
    )
    assert r.status_code == 200, r.text

    r = _convert(client, superuser_token_headers, quote["id"])
    assert r.status_code == 200, r.text
    second = r.json()
    assert second["id"] != invoice["id"]
    assert second["parent_document_id"] == quote["id"]


def test_convert_rejects_non_quote(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)
    tck = _doc_type_id(client, superuser_token_headers, "TCK")
    sale = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],
        },
    )
    r = _convert(client, superuser_token_headers, sale["id"])
    assert r.status_code == 400
    assert "Only quotes" in r.json()["detail"]
