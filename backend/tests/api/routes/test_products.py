"""Tests for the /products endpoints."""

import uuid

from fastapi.testclient import TestClient

from app.core.config import settings
from tests.utils.utils import random_lower_string


def _create_uom(client: TestClient, headers: dict[str, str]) -> dict:
    payload = {
        "name": random_lower_string()[:10],
        "abbreviation": random_lower_string()[:3].upper(),
        "decimal_places": 0,
    }
    r = client.post(f"{settings.API_V1_STR}/uoms/", headers=headers, json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def _build_product_payload(uom_id: str) -> dict:
    return {
        "name": random_lower_string()[:20],
        "sku": random_lower_string()[:12].upper(),
        "uom_id": uom_id,
        "margen_pct": "21.00",
        "costo_actual": "100.00",
        "is_active": True,
        "tax_ids": [],
    }


def test_create_and_read_product(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    uom = _create_uom(client, superuser_token_headers)
    payload = _build_product_payload(uom["id"])
    r = client.post(
        f"{settings.API_V1_STR}/products/",
        headers=superuser_token_headers,
        json=payload,
    )
    assert r.status_code == 200, r.text
    created = r.json()
    assert created["name"] == payload["name"]
    assert created["sku"] == payload["sku"]
    # precio_venta = 100 * (1 + 21/100) = 121.00
    assert created["precio_venta"] == "121.00"
    assert created["stock_current"] == "0.000"

    # read by id
    r = client.get(
        f"{settings.API_V1_STR}/products/{created['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    assert r.json()["id"] == created["id"]


def test_create_product_duplicate_sku_rejected(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    uom = _create_uom(client, superuser_token_headers)
    payload = _build_product_payload(uom["id"])
    r = client.post(
        f"{settings.API_V1_STR}/products/",
        headers=superuser_token_headers,
        json=payload,
    )
    assert r.status_code == 200
    r = client.post(
        f"{settings.API_V1_STR}/products/",
        headers=superuser_token_headers,
        json=payload,
    )
    assert r.status_code == 400
    assert "SKU" in r.json()["detail"]


def test_create_product_invalid_uom(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    payload = _build_product_payload(str(uuid.uuid4()))
    r = client.post(
        f"{settings.API_V1_STR}/products/",
        headers=superuser_token_headers,
        json=payload,
    )
    assert r.status_code == 400
    assert "Unit of measure not found" in r.json()["detail"]


def test_update_product_recomputes_precio_venta(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    uom = _create_uom(client, superuser_token_headers)
    payload = _build_product_payload(uom["id"])
    r = client.post(
        f"{settings.API_V1_STR}/products/",
        headers=superuser_token_headers,
        json=payload,
    )
    pid = r.json()["id"]
    # costo 200, margen 50 -> 300
    r = client.patch(
        f"{settings.API_V1_STR}/products/{pid}",
        headers=superuser_token_headers,
        json={"costo_actual": "200.00", "margen_pct": "50.00"},
    )
    assert r.status_code == 200
    assert r.json()["precio_venta"] == "300.00"


def test_delete_product_soft_deactivates(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    uom = _create_uom(client, superuser_token_headers)
    payload = _build_product_payload(uom["id"])
    r = client.post(
        f"{settings.API_V1_STR}/products/",
        headers=superuser_token_headers,
        json=payload,
    )
    pid = r.json()["id"]
    r = client.delete(
        f"{settings.API_V1_STR}/products/{pid}", headers=superuser_token_headers
    )
    assert r.status_code == 200
    assert r.json()["message"] == "Product deactivated successfully"
    # Verify is_active now False
    r = client.get(
        f"{settings.API_V1_STR}/products/{pid}", headers=superuser_token_headers
    )
    assert r.json()["is_active"] is False


def test_create_product_with_taxes(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    uom = _create_uom(client, superuser_token_headers)
    # Use one seeded tax
    r = client.get(f"{settings.API_V1_STR}/taxes/", headers=superuser_token_headers)
    tax_id = r.json()["data"][0]["id"]
    payload = _build_product_payload(uom["id"])
    payload["tax_ids"] = [tax_id]
    r = client.post(
        f"{settings.API_V1_STR}/products/",
        headers=superuser_token_headers,
        json=payload,
    )
    assert r.status_code == 200
    assert r.json()["taxes"][0]["id"] == tax_id


# ----- Barcodes -----


def test_add_and_delete_barcode(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    uom = _create_uom(client, superuser_token_headers)
    product = _build_product_payload(uom["id"])
    r = client.post(
        f"{settings.API_V1_STR}/products/",
        headers=superuser_token_headers,
        json=product,
    )
    pid = r.json()["id"]

    code = random_lower_string()[:13]
    r = client.post(
        f"{settings.API_V1_STR}/products/{pid}/barcodes",
        headers=superuser_token_headers,
        json={"code": code, "product_id": pid},
    )
    assert r.status_code == 200, r.text
    barcode = r.json()
    assert barcode["code"] == code
    assert barcode["variant_id"] is None
    barcode_id = barcode["id"]

    # duplicate barcode rejected
    r = client.post(
        f"{settings.API_V1_STR}/products/{pid}/barcodes",
        headers=superuser_token_headers,
        json={"code": code, "product_id": pid},
    )
    assert r.status_code == 400
    assert "already exists" in r.json()["detail"]

    # delete the barcode
    r = client.delete(
        f"{settings.API_V1_STR}/products/barcodes/{barcode_id}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200

    # now we can add it again (unique code)
    r = client.post(
        f"{settings.API_V1_STR}/products/{pid}/barcodes",
        headers=superuser_token_headers,
        json={"code": code, "product_id": pid},
    )
    assert r.status_code == 200


def test_add_barcode_to_nonexistent_product_404(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.post(
        f"{settings.API_V1_STR}/products/{uuid.uuid4()}/barcodes",
        headers=superuser_token_headers,
        json={"code": "anything", "product_id": str(uuid.uuid4())},
    )
    assert r.status_code == 404
    assert "Product not found" in r.json()["detail"]


# ----- Variants -----


def test_create_and_delete_variant(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    uom = _create_uom(client, superuser_token_headers)
    product = _build_product_payload(uom["id"])
    r = client.post(
        f"{settings.API_V1_STR}/products/",
        headers=superuser_token_headers,
        json=product,
    )
    pid = r.json()["id"]

    r = client.post(
        f"{settings.API_V1_STR}/products/{pid}/variants",
        headers=superuser_token_headers,
        json={"product_id": pid, "sku_suffix": "RED"},
    )
    assert r.status_code == 200, r.text
    variant = r.json()
    assert variant["sku_suffix"] == "RED"
    variant_id = variant["id"]

    r = client.delete(
        f"{settings.API_V1_STR}/products/variants/{variant_id}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    assert "Variant deleted" in r.json()["message"]


def _create_product(client: TestClient, headers: dict[str, str]) -> dict:
    uom = _create_uom(client, headers)
    r = client.post(
        f"{settings.API_V1_STR}/products/",
        headers=headers,
        json=_build_product_payload(uom["id"]),
    )
    assert r.status_code == 200, r.text
    return r.json()


def _create_attribute(
    client: TestClient, headers: dict[str, str], values: list[str]
) -> dict:
    payload = {"name": random_lower_string()[:15], "values": values}
    r = client.post(f"{settings.API_V1_STR}/attributes/", headers=headers, json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def test_create_variant_links_attribute_values(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    product = _create_product(client, superuser_token_headers)
    attribute = _create_attribute(client, superuser_token_headers, ["Red", "Blue"])
    value_ids = [v["id"] for v in attribute["values"]]

    r = client.post(
        f"{settings.API_V1_STR}/products/{product['id']}/variants",
        headers=superuser_token_headers,
        json={
            "product_id": product["id"],
            "sku_suffix": "RED",
            "attribute_value_ids": [value_ids[0]],
        },
    )
    assert r.status_code == 200, r.text
    variant = r.json()
    assert [v["id"] for v in variant["attribute_values"]] == [value_ids[0]]

    # duplicate combination within the same product is rejected
    r = client.post(
        f"{settings.API_V1_STR}/products/{product['id']}/variants",
        headers=superuser_token_headers,
        json={
            "product_id": product["id"],
            "sku_suffix": "RED2",
            "attribute_value_ids": [value_ids[0]],
        },
    )
    assert r.status_code == 400
    assert "already exists" in r.json()["detail"]

    # unknown attribute value id is rejected
    r = client.post(
        f"{settings.API_V1_STR}/products/{product['id']}/variants",
        headers=superuser_token_headers,
        json={
            "product_id": product["id"],
            "attribute_value_ids": [str(uuid.uuid4())],
        },
    )
    assert r.status_code == 400
    assert "not found" in r.json()["detail"]


def test_add_barcode_scoped_to_variant(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    product = _create_product(client, superuser_token_headers)
    other_product = _create_product(client, superuser_token_headers)
    r = client.post(
        f"{settings.API_V1_STR}/products/{product['id']}/variants",
        headers=superuser_token_headers,
        json={"product_id": product["id"], "sku_suffix": "L"},
    )
    variant_id = r.json()["id"]

    code = random_lower_string()[:13]
    r = client.post(
        f"{settings.API_V1_STR}/products/{product['id']}/barcodes",
        headers=superuser_token_headers,
        json={
            "code": code,
            "product_id": product["id"],
            "variant_id": variant_id,
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["variant_id"] == variant_id

    # a variant from another product is rejected
    r = client.post(
        f"{settings.API_V1_STR}/products/{other_product['id']}/barcodes",
        headers=superuser_token_headers,
        json={
            "code": random_lower_string()[:13],
            "product_id": other_product["id"],
            "variant_id": variant_id,
        },
    )
    assert r.status_code == 400
    assert "Variant not found" in r.json()["detail"]
