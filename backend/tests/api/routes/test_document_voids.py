"""Tests for document voiding (NC, total/partial): POST /documents/{id}/void."""

from fastapi.testclient import TestClient

from app.core.config import settings
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
    return r.json()  # precio_venta = 121.00


def _create_customer(client: TestClient, headers: dict[str, str]) -> dict:
    r = client.post(
        f"{settings.API_V1_STR}/customers/",
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
    return next(row for row in r.json()["data"] if row["prefix"] == prefix)["id"]


def _iva21_id(client: TestClient, headers: dict[str, str]) -> str:
    r = client.get(f"{settings.API_V1_STR}/taxes/", headers=headers)
    return next(row for row in r.json()["data"] if row["code"] == "IVA21")["id"]


def _create_iibb(client: TestClient, headers: dict[str, str]) -> str:
    r = client.post(
        f"{settings.API_V1_STR}/taxes/",
        headers=headers,
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
    return r.json()["id"]


def _create_doc(client: TestClient, headers: dict[str, str], payload: dict) -> dict:
    r = client.post(f"{settings.API_V1_STR}/documents/", headers=headers, json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def _get_doc(client: TestClient, headers: dict[str, str], doc_id: str) -> dict:
    r = client.get(f"{settings.API_V1_STR}/documents/{doc_id}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def test_full_void_creates_nc_and_marks_original_voided(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    iva21 = _iva21_id(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers, [iva21])
    load_stock(client, superuser_token_headers, product["id"], "2")
    tck = _doc_type_id(client, superuser_token_headers, "TCK")
    doc = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "descuento_total": "10.00",
            "lines": [{"product_id": product["id"], "cantidad": "2"}],
        },
    )  # subtotal 242, total 232

    r = client.post(
        f"{settings.API_V1_STR}/documents/{doc['id']}/void",
        headers=superuser_token_headers,
        json={"lines": [], "payments": []},
    )
    assert r.status_code == 200, r.text
    nc = r.json()

    assert nc["document_type"]["name"] == "Nota de Crédito"
    assert nc["parent_document_id"] == doc["id"]
    assert nc["contraparte_id"] == doc["contraparte_id"]
    # exact reversal of the original document
    assert nc["subtotal"] == doc["subtotal"]
    assert nc["descuento_total"] == doc["descuento_total"]
    assert nc["total"] == doc["total"]
    assert nc["estado"] == "active"
    assert len(nc["lines"]) == 1
    assert nc["lines"][0]["cantidad"] == "2.000"
    assert nc["lines"][0]["costo_unitario"] == doc["lines"][0]["costo_unitario"]

    # original is now voided and cannot be voided again
    original = _get_doc(client, superuser_token_headers, doc["id"])
    assert original["estado"] == "voided"
    assert original["lines"][0]["cantidad_pendiente"] == "0.000"
    r = client.post(
        f"{settings.API_V1_STR}/documents/{doc['id']}/void",
        headers=superuser_token_headers,
        json={"lines": [], "payments": []},
    )
    assert r.status_code == 400
    assert "already voided" in r.json()["detail"]["message"]

    # the NC itself is not voidable
    r = client.post(
        f"{settings.API_V1_STR}/documents/{nc['id']}/void",
        headers=superuser_token_headers,
        json={"lines": [], "payments": []},
    )
    assert r.status_code == 400
    assert "not voidable" in r.json()["detail"]["message"]


def test_partial_void_accumulates_remaining(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "5")
    tck = _doc_type_id(client, superuser_token_headers, "TCK")
    doc = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "lines": [
                {"product_id": product["id"], "cantidad": "5", "descuento_pct": "10"}
            ],
        },
    )
    line_id = doc["lines"][0]["id"]

    def _void(qty: str) -> dict:
        r = client.post(
            f"{settings.API_V1_STR}/documents/{doc['id']}/void",
            headers=superuser_token_headers,
            json={
                "lines": [{"document_line_id": line_id, "cantidad": qty}],
                "payments": [],
            },
        )
        return r

    # partial: 2 of 5; original stays active with 3 pending
    r = _void("2")
    assert r.status_code == 200, r.text
    nc = r.json()
    assert nc["lines"][0]["cantidad"] == "2.000"
    assert nc["lines"][0]["subtotal_line"] == "217.80"  # 2*121 - 10%
    assert nc["descuento_total"] == "0.00"  # partial voids keep doc discount out
    original = _get_doc(client, superuser_token_headers, doc["id"])
    assert original["estado"] == "active"
    assert original["lines"][0]["cantidad_pendiente"] == "3.000"

    # over-voiding is rejected against accumulated remaining
    r = _void("4")
    assert r.status_code == 400
    assert "exceeds" in r.json()["detail"]["message"]

    # voiding the rest flips the original to voided
    r = _void("3")
    assert r.status_code == 200
    original = _get_doc(client, superuser_token_headers, doc["id"])
    assert original["estado"] == "voided"
    assert original["lines"][0]["cantidad_pendiente"] == "0.000"


def test_full_void_reverses_percepciones(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    iibb = _create_iibb(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers, [iibb])
    load_stock(client, superuser_token_headers, product["id"], "2")
    tck = _doc_type_id(client, superuser_token_headers, "TCK")
    doc = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "2"}],
        },
    )  # subtotal 242, percepcion 7.26, total 249.26

    r = client.post(
        f"{settings.API_V1_STR}/documents/{doc['id']}/void",
        headers=superuser_token_headers,
        json={"lines": [], "payments": []},
    )
    assert r.status_code == 200
    nc = r.json()
    assert nc["total"] == doc["total"]
    nc_iibb = next(t for t in nc["taxes"] if t["tax_id"] == iibb)
    assert nc_iibb["base"] == "242.00"
    assert nc_iibb["monto"] == "7.26"


def test_void_rejects_foreign_line(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "2")
    tck = _doc_type_id(client, superuser_token_headers, "TCK")
    payload = {
        "document_type_id": tck,
        "contraparte_id": customer["id"],
        "lines": [{"product_id": product["id"], "cantidad": "1"}],
    }
    doc_a = _create_doc(client, superuser_token_headers, payload)
    doc_b = _create_doc(client, superuser_token_headers, payload)

    r = client.post(
        f"{settings.API_V1_STR}/documents/{doc_a['id']}/void",
        headers=superuser_token_headers,
        json={
            "lines": [
                {
                    "document_line_id": doc_b["lines"][0]["id"],
                    "cantidad": "1",
                }
            ],
            "payments": [],
        },
    )
    assert r.status_code == 400
    assert "does not belong" in r.json()["detail"]["message"]


def test_quote_is_not_voidable(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)
    cot = _doc_type_id(client, superuser_token_headers, "COT")
    doc = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": cot,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],
        },
    )
    r = client.post(
        f"{settings.API_V1_STR}/documents/{doc['id']}/void",
        headers=superuser_token_headers,
        json={"lines": [], "payments": []},
    )
    assert r.status_code == 400
    assert "not voidable" in r.json()["detail"]["message"]


def test_purchase_void_uses_nc_compra(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.post(
        f"{settings.API_V1_STR}/suppliers/",
        headers=superuser_token_headers,
        json={"razon_social": random_lower_string()[:20]},
    )
    supplier = r.json()
    product = _create_product(client, superuser_token_headers)
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
    r = client.post(
        f"{settings.API_V1_STR}/documents/{doc['id']}/void",
        headers=superuser_token_headers,
        json={"lines": [], "payments": []},
    )
    assert r.status_code == 200
    nc = r.json()
    assert nc["document_type"]["name"] == "NC Compra"
    assert nc["contraparte_id"] == doc["contraparte_id"]
    assert _get_doc(client, superuser_token_headers, doc["id"])["estado"] == "voided"
