"""Tests for the /products endpoints."""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.models import DocumentType
from tests.utils.ledger import load_stock
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


def test_delete_product_hard_deletes_when_unused(
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
    assert r.json()["message"] == "Product deleted successfully"
    # Verify it is gone (hard delete)
    r = client.get(
        f"{settings.API_V1_STR}/products/{pid}", headers=superuser_token_headers
    )
    assert r.status_code == 404


def test_delete_product_used_in_document_is_blocked(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    uom = _create_uom(client, superuser_token_headers)
    payload = _build_product_payload(uom["id"])
    r = client.post(
        f"{settings.API_V1_STR}/products/",
        headers=superuser_token_headers,
        json=payload,
    )
    assert r.status_code == 200
    pid = r.json()["id"]
    # Load stock so the sale can be issued without negative stock.
    load_stock(client, superuser_token_headers, pid, "3")
    # Create a customer and a sale referencing the product.
    r = client.post(
        f"{settings.API_V1_STR}/customers/",
        headers=superuser_token_headers,
        json={"razon_social": random_lower_string()[:20], "condicion_fiscal": "RI"},
    )
    assert r.status_code == 200, r.text
    customer_id = r.json()["id"]
    tck = db.exec(select(DocumentType).where(DocumentType.prefix == "TCK")).one()
    r = client.post(
        f"{settings.API_V1_STR}/documents/",
        headers=superuser_token_headers,
        json={
            "document_type_id": str(tck.id),
            "contraparte_id": customer_id,
            "lines": [{"product_id": pid, "cantidad": "1"}],
            "payments": [],
        },
    )
    assert r.status_code == 200, r.text
    doc_numero = r.json()["numero"]
    r = client.delete(
        f"{settings.API_V1_STR}/products/{pid}", headers=superuser_token_headers
    )
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert detail["code"] == "product_in_use"
    assert any(d["numero"] == doc_numero for d in detail["documents"])
    # The product is still there (deactivation path unaffected)
    r = client.get(
        f"{settings.API_V1_STR}/products/{pid}", headers=superuser_token_headers
    )
    assert r.status_code == 200


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


def test_search_products_by_name_sku_and_barcode(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    product = _create_product(client, superuser_token_headers)
    other = _create_product(client, superuser_token_headers)
    code = random_lower_string()[:13]
    r = client.post(
        f"{settings.API_V1_STR}/products/{product['id']}/barcodes",
        headers=superuser_token_headers,
        json={"code": code, "product_id": product["id"]},
    )
    assert r.status_code == 200, r.text

    def _search(q: str) -> list[dict]:
        r = client.get(
            f"{settings.API_V1_STR}/products/search",
            headers=superuser_token_headers,
            params={"q": q},
        )
        assert r.status_code == 200, r.text
        return r.json()["data"]

    # by barcode code (partial match)
    assert [p["id"] for p in _search(code[:-2])] == [product["id"]]
    # by sku (partial, case-insensitive)
    sku = product["sku"]
    assert [p["id"] for p in _search(sku[:3])] == [product["id"]]
    # by name fragment
    assert [p["id"] for p in _search(product["name"][:6])] == [product["id"]]
    # inactive products are excluded
    r = client.delete(
        f"{settings.API_V1_STR}/products/{other['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    assert all(p["id"] != other["id"] for p in _search(other["name"][:6]))
    # an empty term is rejected by the schema
    r = client.get(
        f"{settings.API_V1_STR}/products/search",
        headers=superuser_token_headers,
        params={"q": ""},
    )
    assert r.status_code == 422


def test_search_exact_barcode_beats_exact_name_match(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """An exact barcode match outranks an exact name match (spec product-search).

    The name-matching product ("777000000001") sorts before any letter-named
    product alphabetically, so name-only ordering would put it first.
    """
    barcode_product = _create_product(client, superuser_token_headers)
    r = client.post(
        f"{settings.API_V1_STR}/products/{barcode_product['id']}/barcodes",
        headers=superuser_token_headers,
        json={"code": "777000000001", "product_id": barcode_product["id"]},
    )
    assert r.status_code == 200, r.text
    name_product_payload = _build_product_payload(
        _create_uom(client, superuser_token_headers)["id"]
    )
    name_product_payload["name"] = "777000000001"
    r = client.post(
        f"{settings.API_V1_STR}/products/",
        headers=superuser_token_headers,
        json=name_product_payload,
    )
    assert r.status_code == 200, r.text
    name_product = r.json()

    r = client.get(
        f"{settings.API_V1_STR}/products/search",
        headers=superuser_token_headers,
        params={"q": "777000000001"},
    )
    assert r.status_code == 200, r.text
    ids = [p["id"] for p in r.json()["data"]]
    assert ids[0] == barcode_product["id"]
    assert name_product["id"] in ids


def test_search_exact_name_beats_partial_match(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """An exact name match outranks a partial match (spec product-search).

    The partial match sorts before the exact match alphabetically, so
    name-only ordering would put it first.
    """
    exact_payload = _build_product_payload(
        _create_uom(client, superuser_token_headers)["id"]
    )
    exact_payload["name"] = "Zeta Product"
    r = client.post(
        f"{settings.API_V1_STR}/products/",
        headers=superuser_token_headers,
        json=exact_payload,
    )
    assert r.status_code == 200, r.text
    exact_product = r.json()

    partial_payload = _build_product_payload(
        _create_uom(client, superuser_token_headers)["id"]
    )
    partial_payload["name"] = "Alpha Zeta Product Extra"
    r = client.post(
        f"{settings.API_V1_STR}/products/",
        headers=superuser_token_headers,
        json=partial_payload,
    )
    assert r.status_code == 200, r.text
    partial_product = r.json()

    r = client.get(
        f"{settings.API_V1_STR}/products/search",
        headers=superuser_token_headers,
        params={"q": "Zeta Product"},
    )
    assert r.status_code == 200, r.text
    ids = [p["id"] for p in r.json()["data"]]
    assert ids[0] == exact_product["id"]
    assert partial_product["id"] in ids


def test_search_variant_barcode_returns_parent_exposing_variant(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """A variant-barcode query returns the parent product exposing the variant."""
    product = _create_product(client, superuser_token_headers)
    attribute = _create_attribute(client, superuser_token_headers, ["Large", "XLarge"])
    value_ids = [v["id"] for v in attribute["values"]]
    r = client.post(
        f"{settings.API_V1_STR}/products/{product['id']}/variants",
        headers=superuser_token_headers,
        json={
            "product_id": product["id"],
            "sku_suffix": "L",
            "attribute_value_ids": [value_ids[0]],
        },
    )
    assert r.status_code == 200, r.text
    variant_l = r.json()
    r = client.post(
        f"{settings.API_V1_STR}/products/{product['id']}/variants",
        headers=superuser_token_headers,
        json={
            "product_id": product["id"],
            "sku_suffix": "XL",
            "attribute_value_ids": [value_ids[1]],
        },
    )
    assert r.status_code == 200, r.text
    variant_xl = r.json()
    r = client.post(
        f"{settings.API_V1_STR}/products/{product['id']}/barcodes",
        headers=superuser_token_headers,
        json={
            "code": "888000000002",
            "product_id": product["id"],
            "variant_id": variant_xl["id"],
        },
    )
    assert r.status_code == 200, r.text

    r = client.get(
        f"{settings.API_V1_STR}/products/search",
        headers=superuser_token_headers,
        params={"q": "888000000002"},
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert [p["id"] for p in data] == [product["id"]]
    # the parent exposes the variants (with barcodes) so the caller can
    # resolve which variant the scanned code belongs to
    variants = {v["id"]: v for v in data[0]["variants"]}
    assert variant_xl["id"] in variants
    assert variant_l["id"] in variants
    assert any(
        b["code"] == "888000000002" for b in variants[variant_xl["id"]]["barcodes"]
    )


def test_search_results_carry_uom(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """Search items embed the product's unit of measure (name/abbrev/decimals)."""
    r = client.post(
        f"{settings.API_V1_STR}/uoms/",
        headers=superuser_token_headers,
        json={
            "name": "kilogram",
            "abbreviation": "kg",
            "decimal_places": 3,
        },
    )
    assert r.status_code == 200, r.text
    uom = r.json()
    payload = _build_product_payload(uom["id"])
    r = client.post(
        f"{settings.API_V1_STR}/products/",
        headers=superuser_token_headers,
        json=payload,
    )
    assert r.status_code == 200, r.text
    product = r.json()

    r = client.get(
        f"{settings.API_V1_STR}/products/search",
        headers=superuser_token_headers,
        params={"q": product["name"]},
    )
    assert r.status_code == 200, r.text
    items = [p for p in r.json()["data"] if p["id"] == product["id"]]
    assert len(items) == 1
    assert items[0]["uom"]["id"] == uom["id"]
    assert items[0]["uom"]["name"] == "kilogram"
    assert items[0]["uom"]["abbreviation"] == "kg"
    assert items[0]["uom"]["decimal_places"] == 3


# ----- Server-side list (q / category filters, ordering, counts) -----


def test_list_products_filters_by_q_and_is_ordered(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    uom = _create_uom(client, superuser_token_headers)
    names = ["Zulu Alpha Product", "Alpha Bravo Product", "Middle Gamma Product"]
    skus = ["SKU-ZZZ-1", "SKU-AAA-1", "SKU-MMM-1"]
    ids = []
    for name, sku in zip(names, skus, strict=True):
        r = client.post(
            f"{settings.API_V1_STR}/products/",
            headers=superuser_token_headers,
            json={
                "name": name,
                "sku": sku,
                "uom_id": uom["id"],
                "margen_pct": "21.00",
                "costo_actual": "100.00",
                "is_active": True,
                "tax_ids": [],
            },
        )
        assert r.status_code == 200, r.text
        ids.append(r.json()["id"])

    # by name fragment (case-insensitive)
    r = client.get(
        f"{settings.API_V1_STR}/products/",
        headers=superuser_token_headers,
        params={"q": "bravo", "limit": 100},
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert r.json()["count"] == 1
    assert data[0]["id"] == ids[1]

    # by sku fragment
    r = client.get(
        f"{settings.API_V1_STR}/products/",
        headers=superuser_token_headers,
        params={"q": "skU-zzz", "limit": 100},
    )
    assert r.json()["count"] == 1
    assert r.json()["data"][0]["id"] == ids[0]

    # by barcode fragment
    code = "7791234567890"
    r = client.post(
        f"{settings.API_V1_STR}/products/{ids[2]}/barcodes",
        headers=superuser_token_headers,
        json={"code": code, "product_id": ids[2]},
    )
    assert r.status_code == 200, r.text
    r = client.get(
        f"{settings.API_V1_STR}/products/",
        headers=superuser_token_headers,
        params={"q": code[:-2], "limit": 100},
    )
    assert r.json()["count"] == 1
    assert r.json()["data"][0]["id"] == ids[2]

    # deterministic ordering by name
    r = client.get(
        f"{settings.API_V1_STR}/products/",
        headers=superuser_token_headers,
        params={"q": "product", "limit": 100},
    )
    names = [p["name"].lower() for p in r.json()["data"]]
    assert names == sorted(names)


def test_list_products_filters_by_category(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    cat_r = client.post(
        f"{settings.API_V1_STR}/categories/",
        headers=superuser_token_headers,
        json={"name": random_lower_string()[:20]},
    )
    assert cat_r.status_code == 200, cat_r.text
    category_id = cat_r.json()["id"]

    uom = _create_uom(client, superuser_token_headers)
    in_cat_id = None
    out_cat_id = None
    for name, use_category in [
        ("Product In Category", True),
        ("Product Outside Category", False),
    ]:
        payload = _build_product_payload(uom["id"])
        payload["name"] = name
        payload["category_id"] = category_id if use_category else None
        r = client.post(
            f"{settings.API_V1_STR}/products/",
            headers=superuser_token_headers,
            json=payload,
        )
        assert r.status_code == 200, r.text
        if use_category:
            in_cat_id = r.json()["id"]
        else:
            out_cat_id = r.json()["id"]

    r = client.get(
        f"{settings.API_V1_STR}/products/",
        headers=superuser_token_headers,
        params={"category_id": category_id, "limit": 100},
    )
    assert r.status_code == 200
    ids = {p["id"] for p in r.json()["data"]}
    assert in_cat_id in ids
    assert out_cat_id not in ids


def test_list_products_items_are_lightweight(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    product = _create_product(client, superuser_token_headers)
    r = client.post(
        f"{settings.API_V1_STR}/products/{product['id']}/variants",
        headers=superuser_token_headers,
        json={"product_id": product["id"], "sku_suffix": "RED"},
    )
    assert r.status_code == 200, r.text
    r = client.get(
        f"{settings.API_V1_STR}/products/",
        headers=superuser_token_headers,
        params={"q": product["name"], "limit": 100},
    )
    assert r.status_code == 200
    item = r.json()["data"][0]
    # list rows keep taxes (rendered as badges) but not nested barcodes/variants
    assert "taxes" in item
    assert "barcodes" not in item
    assert "variants" not in item
    # the detail endpoint still returns the full payload
    r = client.get(
        f"{settings.API_V1_STR}/products/{product['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    assert len(r.json()["variants"]) == 1


def test_product_category_counts(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    cat_r = client.post(
        f"{settings.API_V1_STR}/categories/",
        headers=superuser_token_headers,
        json={"name": random_lower_string()[:20]},
    )
    assert cat_r.status_code == 200, cat_r.text
    category_id = cat_r.json()["id"]

    uom = _create_uom(client, superuser_token_headers)
    payload = _build_product_payload(uom["id"])
    payload["category_id"] = category_id
    r = client.post(
        f"{settings.API_V1_STR}/products/",
        headers=superuser_token_headers,
        json=payload,
    )
    assert r.status_code == 200, r.text

    r = client.get(
        f"{settings.API_V1_STR}/products/counts-by-category",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] >= 1
    entry = next(
        (e for e in body["by_category"] if e["category_id"] == category_id), None
    )
    assert entry is not None
    assert entry["count"] >= 1
    # uncategorized products are reported under a null category_id
    r = client.post(
        f"{settings.API_V1_STR}/products/",
        headers=superuser_token_headers,
        json=_build_product_payload(uom["id"]),
    )
    assert r.status_code == 200, r.text
    uncategorized_id = r.json()["id"]
    r = client.get(
        f"{settings.API_V1_STR}/products/counts-by-category",
        headers=superuser_token_headers,
    )
    body = r.json()
    assert body["total"] >= 2
    none_entry = next(
        (e for e in body["by_category"] if e["category_id"] is None), None
    )
    assert none_entry is not None
    assert none_entry["count"] >= 1
    # the product is still findable in the list
    r = client.get(
        f"{settings.API_V1_STR}/products/{uncategorized_id}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
