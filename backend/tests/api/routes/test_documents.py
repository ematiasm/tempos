"""Tests for the /documents endpoints."""

import re
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.models import PaymentMethod
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
    tax_ids: list[str] | None = None,
) -> dict:
    uom = _create_uom(client, headers)
    r = client.post(
        f"{settings.API_V1_STR}/products/",
        headers=headers,
        json={
            "name": random_lower_string()[:20],
            "uom_id": uom["id"],
            "margen_pct": margen,
            "costo_actual": costo,
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


def _create_supplier(client: TestClient, headers: dict[str, str]) -> dict:
    r = client.post(
        f"{settings.API_V1_STR}/suppliers/",
        headers=headers,
        json={"razon_social": random_lower_string()[:20], "condicion_fiscal": "RI"},
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


def _iva21_id(client: TestClient, headers: dict[str, str]) -> str:
    r = client.get(f"{settings.API_V1_STR}/taxes/", headers=headers)
    return next(row for row in r.json()["data"] if row["code"] == "IVA21")["id"]


def _cash_method_id(db: Session) -> str:
    method = db.exec(
        select(PaymentMethod).where(PaymentMethod.name == "Efectivo")
    ).first()
    assert method is not None, "Seeded cash payment method not found"
    return str(method.id)


def _create_doc(client: TestClient, headers: dict[str, str], payload: dict) -> dict:
    r = client.post(f"{settings.API_V1_STR}/documents/", headers=headers, json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def test_create_sale_document_computes_totals_and_taxes(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    iva21 = _iva21_id(client, superuser_token_headers)
    product = _create_product(
        client, superuser_token_headers, tax_ids=[iva21]
    )  # precio_venta = 121.00
    type_id = _doc_type_id(client, superuser_token_headers, "TCK")
    payload = {
        "document_type_id": type_id,
        "contraparte_id": customer["id"],
        "descuento_total": "10.00",
        "lines": [
            {
                "product_id": product["id"],
                "cantidad": "2",
                "descuento_pct": "10",  # 2 * 121 = 242 - 24.20 = 217.80
            },
            {
                "product_id": product["id"],
                "cantidad": "1",
                "precio_unit": "100.00",
                "descuento_monto": "10.00",  # 100 - 10 = 90
            },
        ],
        "payments": [{"payment_method_id": _cash_method_id(db), "monto": "297.80"}],
    }
    doc = _create_doc(client, superuser_token_headers, payload)

    # totals: subtotal 217.80 + 90.00 = 307.80; total = 307.80 - 10.00
    assert doc["subtotal"] == "307.80"
    assert doc["descuento_total"] == "10.00"
    assert doc["total"] == "297.80"
    assert doc["estado"] == "active"
    assert doc["contraparte_name"] == customer["razon_social"]
    assert doc["contraparte_type"] == "customer"

    # lines: computed values + cost snapshot
    lines = sorted(doc["lines"], key=lambda x: x["orden"])
    assert lines[0]["subtotal_line"] == "217.80"
    assert lines[0]["descuento_monto"] == "24.20"
    assert lines[0]["costo_unitario"] == "100.00"
    assert lines[1]["subtotal_line"] == "90.00"
    assert lines[1]["precio_unit"] == "100.00"

    # IVA 21 breakdown is informational (prices carry IVA inside)
    for line in lines:
        iva = next(t for t in line["taxes"] if t["tax_id"] == iva21)
        assert iva["aplicado"] is True
        expected = str(
            (Decimal(line["subtotal_line"]) * Decimal("0.21")).quantize(Decimal("0.01"))
        )
        assert iva["monto"] == expected

    # line-level taxes are not aggregated to DocumentTax
    # (only document-level percepciones land there)
    assert doc["taxes"] == []

    assert len(doc["payments"]) == 1
    assert doc["payments"][0]["monto"] == "297.80"


def test_document_numbering_sequential_per_type(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)
    type_id = _doc_type_id(client, superuser_token_headers, "TCK")
    payload = {
        "document_type_id": type_id,
        "contraparte_id": customer["id"],
        "lines": [{"product_id": product["id"], "cantidad": "1"}],
    }
    first = _create_doc(client, superuser_token_headers, payload)
    second = _create_doc(client, superuser_token_headers, payload)

    pattern = re.compile(r"^\d{4}-TCK-(\d{8})$")
    m1, m2 = pattern.match(first["numero"]), pattern.match(second["numero"])
    assert m1 and m2
    assert int(m2.group(1)) == int(m1.group(1)) + 1


def test_numbering_defaults_to_current_year(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    from datetime import datetime

    customer = _create_customer(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)
    type_id = _doc_type_id(client, superuser_token_headers, "COT")
    doc = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": type_id,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],
        },
    )
    assert doc["year"] == datetime.now().year
    assert doc["numero"].startswith(f"{datetime.now().year}-COT-")


def test_document_level_percepciones_add_to_total(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    # IIBB percepción, 3%, applies at document level
    r = client.post(
        f"{settings.API_V1_STR}/taxes/",
        headers=superuser_token_headers,
        json={
            "name": "Perc IIBB",
            "code": random_lower_string()[:8].upper(),
            "tipo": "IIBB",
            "rate": "3.00",
            "is_percent": True,
            "aplica_a": "documento",
        },
    )
    assert r.status_code == 200, r.text
    iibb_id = r.json()["id"]
    product = _create_product(client, superuser_token_headers, tax_ids=[iibb_id])
    type_id = _doc_type_id(client, superuser_token_headers, "TCK")
    doc = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": type_id,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "2"}],  # 242.00
        },
    )
    # percepción computed and added on top of the subtotal
    doc_tax = next(t for t in doc["taxes"] if t["tax_id"] == iibb_id)
    assert doc_tax["base"] == "242.00"
    assert doc_tax["monto"] == "7.26"
    assert doc["total"] == "249.26"


def test_line_tax_override_removes_taxes_from_line(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    iva21 = _iva21_id(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers, tax_ids=[iva21])
    type_id = _doc_type_id(client, superuser_token_headers, "TCK")
    doc = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": type_id,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1", "tax_ids": []}],
        },
    )
    assert doc["lines"][0]["taxes"] == []


def test_create_document_validation_errors(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    supplier = _create_supplier(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)
    tck = _doc_type_id(client, superuser_token_headers, "TCK")
    ajs = _doc_type_id(client, superuser_token_headers, "AJS")
    base = {"lines": [{"product_id": product["id"], "cantidad": "1"}]}

    # sale type without a counterpart
    r = client.post(
        f"{settings.API_V1_STR}/documents/",
        headers=superuser_token_headers,
        json={**base, "document_type_id": tck},
    )
    assert r.status_code == 400
    assert "requires a counterpart" in r.json()["detail"]

    # supplier id used as a customer
    r = client.post(
        f"{settings.API_V1_STR}/documents/",
        headers=superuser_token_headers,
        json={**base, "document_type_id": tck, "contraparte_id": supplier["id"]},
    )
    assert r.status_code == 400
    assert "Counterpart not found" in r.json()["detail"]

    # adjustment type does not take a counterpart
    r = client.post(
        f"{settings.API_V1_STR}/documents/",
        headers=superuser_token_headers,
        json={**base, "document_type_id": ajs, "contraparte_id": customer["id"]},
    )
    assert r.status_code == 400
    assert "does not take a counterpart" in r.json()["detail"]

    # document discount above subtotal
    r = client.post(
        f"{settings.API_V1_STR}/documents/",
        headers=superuser_token_headers,
        json={
            **base,
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "descuento_total": "99999.00",
        },
    )
    assert r.status_code == 400
    assert "exceeds" in r.json()["detail"]


def test_suggest_fiscal_sale_type(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    settings_url = f"{settings.API_V1_STR}/business-settings/"
    customer_ri = _create_customer(client, superuser_token_headers, "RI")
    customer_cf = _create_customer(client, superuser_token_headers, "Consumidor Final")

    def _suggest(customer_id: str) -> str:
        r = client.get(
            f"{settings.API_V1_STR}/documents/suggest-type",
            headers=superuser_token_headers,
            params={"customer_id": customer_id},
        )
        assert r.status_code == 200, r.text
        return r.json()["name"]

    # business Consumidor Final (seeded default) → always Factura C
    client.patch(
        settings_url,
        headers=superuser_token_headers,
        json={"condicion_fiscal": "Consumidor Final"},
    )
    assert _suggest(customer_ri["id"]) == "Factura C"
    assert _suggest(customer_cf["id"]) == "Factura C"

    # RI business: RI customer → A, others → B
    client.patch(
        settings_url,
        headers=superuser_token_headers,
        json={"condicion_fiscal": "RI"},
    )
    assert _suggest(customer_ri["id"]) == "Factura A"
    assert _suggest(customer_cf["id"]) == "Factura B"

    # Monotributo business → C
    client.patch(
        settings_url,
        headers=superuser_token_headers,
        json={"condicion_fiscal": "Monotributo"},
    )
    assert _suggest(customer_ri["id"]) == "Factura C"

    # restore the seeded default
    client.patch(
        settings_url,
        headers=superuser_token_headers,
        json={"condicion_fiscal": "Consumidor Final"},
    )


def test_payment_methods_seeded(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.get(
        f"{settings.API_V1_STR}/payment-methods/",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    names = {row["name"] for row in r.json()["data"]}
    assert "Efectivo" in names


def test_read_document_detail(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)
    type_id = _doc_type_id(client, superuser_token_headers, "TCK")
    doc = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": type_id,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],
        },
    )
    r = client.get(
        f"{settings.API_V1_STR}/documents/{doc['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["numero"] == doc["numero"]
    assert body["document_type"]["name"] == "Ticket"
    assert body["lines"][0]["product_id"] == product["id"]

    # list also includes it
    r = client.get(f"{settings.API_V1_STR}/documents/", headers=superuser_token_headers)
    assert r.status_code == 200
    assert any(d["id"] == doc["id"] for d in r.json()["data"])
