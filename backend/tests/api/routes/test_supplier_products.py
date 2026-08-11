"""Tests for the /supplier-products endpoints and purchase cost suggestions."""

from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.models import Product, SupplierProduct
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
    client: TestClient, headers: dict[str, str], *, costo: str = "100.00"
) -> dict:
    uom = _create_uom(client, headers)
    r = client.post(
        f"{settings.API_V1_STR}/products/",
        headers=headers,
        json={
            "name": random_lower_string()[:20],
            "uom_id": uom["id"],
            "margen_pct": "21.00",
            "costo_actual": costo,
            "tax_ids": [],
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


def _pair_url(supplier_id: str, product_id: str) -> str:
    return f"{settings.API_V1_STR}/supplier-products/{supplier_id}/{product_id}"


def _create_pair(
    client: TestClient,
    headers: dict[str, str],
    supplier_id: str,
    product_id: str,
    costo: str,
    **flags: bool,
) -> dict:
    r = client.post(
        f"{settings.API_V1_STR}/supplier-products/",
        headers=headers,
        json={
            "supplier_id": supplier_id,
            "product_id": product_id,
            "costo_actual": costo,
            **flags,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def _product_costs(
    client: TestClient, headers: dict[str, str], product_id: str
) -> list[dict]:
    r = client.get(
        f"{settings.API_V1_STR}/supplier-products/",
        headers=headers,
        params={"product_id": product_id, "limit": 100},
    )
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _create_oc(
    client: TestClient,
    headers: dict[str, str],
    supplier_id: str,
    product_id: str,
    precio: str,
) -> dict:
    oc = _doc_type_id(client, headers, "OC")
    r = client.post(
        f"{settings.API_V1_STR}/documents/",
        headers=headers,
        json={
            "document_type_id": oc,
            "contraparte_id": supplier_id,
            "lines": [
                {"product_id": product_id, "cantidad": "1", "precio_unit": precio}
            ],
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_supplier_product_crud_flow(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    supplier = _create_supplier(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)

    pair = _create_pair(
        client, superuser_token_headers, supplier["id"], product["id"], "150.00"
    )
    assert pair["costo_anterior"] == "0.00"
    assert pair["costo_actual"] == "150.00"
    assert pair["supplier_name"] == supplier["razon_social"]
    assert pair["product_name"] == product["name"]
    # first registered pair is auto-promoted to reference (no reference existed)
    assert pair["es_referencia"] is True

    # duplicate pair is rejected
    r = client.post(
        f"{settings.API_V1_STR}/supplier-products/",
        headers=superuser_token_headers,
        json={
            "supplier_id": supplier["id"],
            "product_id": product["id"],
            "costo_actual": "160.00",
        },
    )
    assert r.status_code == 400
    assert "already exists" in r.json()["detail"]

    # cost update moves the old value to costo_anterior and stamps the date
    r = client.patch(
        _pair_url(supplier["id"], product["id"]),
        headers=superuser_token_headers,
        json={"costo_actual": "180.00"},
    )
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["costo_anterior"] == "150.00"
    assert updated["costo_actual"] == "180.00"
    assert updated["fecha_actualizacion"] is not None

    # negative cost is rejected by the schema
    r = client.patch(
        _pair_url(supplier["id"], product["id"]),
        headers=superuser_token_headers,
        json={"costo_actual": "-1.00"},
    )
    assert r.status_code == 422

    # list filters by supplier
    rows = _product_costs(client, superuser_token_headers, product["id"])
    assert len(rows) == 1
    assert rows[0]["supplier_id"] == supplier["id"]

    # delete removes the pair
    r = client.delete(
        _pair_url(supplier["id"], product["id"]),
        headers=superuser_token_headers,
    )
    assert r.status_code == 200, r.text
    assert _product_costs(client, superuser_token_headers, product["id"]) == []


def test_reference_supplier_drives_product_cost(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    supp_a = _create_supplier(client, superuser_token_headers)
    supp_b = _create_supplier(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)  # costo 100 → 121.00

    # first supplier becomes the reference → product cost + price follow it
    pair_a = _create_pair(
        client,
        superuser_token_headers,
        supp_a["id"],
        product["id"],
        "250.00",
        es_referencia=True,
    )
    assert pair_a["es_referencia"] is True
    assert db.get(Product, product["id"]).costo_actual == Decimal("250.00")
    assert db.get(Product, product["id"]).precio_venta == Decimal("302.50")

    # a non-reference second supplier does not affect the product
    _create_pair(client, superuser_token_headers, supp_b["id"], product["id"], "200.00")
    assert db.get(Product, product["id"]).costo_actual == Decimal("250.00")

    # promoting B to reference moves the flags and the source of cost
    r = client.patch(
        _pair_url(supp_b["id"], product["id"]),
        headers=superuser_token_headers,
        json={"es_referencia": True},
    )
    assert r.status_code == 200, r.text
    assert r.json()["es_referencia"] is True
    flags = {
        pair["supplier_id"]: pair["es_referencia"]
        for pair in _product_costs(client, superuser_token_headers, product["id"])
    }
    assert flags[supp_a["id"]] is False
    assert flags[supp_b["id"]] is True
    assert db.get(Product, product["id"]).costo_actual == Decimal("200.00")
    assert db.get(Product, product["id"]).precio_venta == Decimal("242.00")

    # only one pair can be the default supplier
    r = client.patch(
        _pair_url(supp_a["id"], product["id"]),
        headers=superuser_token_headers,
        json={"es_default": True},
    )
    assert r.status_code == 200, r.text
    r = client.patch(
        _pair_url(supp_b["id"], product["id"]),
        headers=superuser_token_headers,
        json={"es_default": True},
    )
    assert r.status_code == 200, r.text
    defaults = [
        pair["supplier_id"]
        for pair in _product_costs(client, superuser_token_headers, product["id"])
        if pair["es_default"]
    ]
    assert defaults == [supp_b["id"]]


def test_purchase_suggests_cost_increase_without_applying(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    supplier = _create_supplier(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)  # product cost 100
    _create_pair(
        client, superuser_token_headers, supplier["id"], product["id"], "100.00"
    )

    doc = _create_oc(
        client, superuser_token_headers, supplier["id"], product["id"], "130.00"
    )
    suggestions = doc["cost_change_suggestions"]
    assert len(suggestions) == 1
    suggestion = suggestions[0]
    assert suggestion["product_id"] == product["id"]
    assert suggestion["product_name"] == product["name"]
    assert suggestion["previous_cost"] == "100.00"
    assert suggestion["suggested_cost"] == "130.00"
    # the pair was auto-promoted to reference when it was first registered
    assert suggestion["is_reference"] is True

    # nothing was mutated: the pair and the product keep their costs
    pair = db.get(SupplierProduct, (supplier["id"], product["id"]))
    assert pair is not None
    assert pair.costo_actual == Decimal("100.00")
    assert db.get(Product, product["id"]).costo_actual == Decimal("100.00")

    # the void response carries the (empty) suggestion list too
    r = client.post(
        f"{settings.API_V1_STR}/documents/{doc['id']}/void",
        headers=superuser_token_headers,
        json={"lines": [], "payments": []},
    )
    assert r.status_code == 200, r.text
    assert r.json()["cost_change_suggestions"] == []


def test_first_purchase_suggests_without_previous_cost(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    supplier = _create_supplier(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)

    doc = _create_oc(
        client, superuser_token_headers, supplier["id"], product["id"], "130.00"
    )
    suggestions = doc["cost_change_suggestions"]
    assert len(suggestions) == 1
    assert suggestions[0]["previous_cost"] is None
    assert suggestions[0]["suggested_cost"] == "130.00"


def test_first_purchase_at_or_below_product_cost_suggests_nothing(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    supplier = _create_supplier(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)  # cost 100

    # the pair is not registered yet: a below-cost first purchase must not
    # propose anything either
    doc = _create_oc(
        client, superuser_token_headers, supplier["id"], product["id"], "90.00"
    )
    assert doc["cost_change_suggestions"] == []


def test_suggestion_compares_against_product_cost(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    supp_a = _create_supplier(client, superuser_token_headers)
    supp_b = _create_supplier(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)  # cost 100
    _create_pair(
        client, superuser_token_headers, supp_a["id"], product["id"], "150.00"
    )  # auto-promoted → product cost 150
    _create_pair(
        client, superuser_token_headers, supp_b["id"], product["id"], "100.00"
    )  # stays non-reference

    # price above the supplier's recorded cost but below the product's cost:
    # the old logic suggested it, the new one must not
    doc = _create_oc(
        client, superuser_token_headers, supp_b["id"], product["id"], "120.00"
    )
    assert doc["cost_change_suggestions"] == []

    # once the price exceeds the product's cost, it is suggested again
    doc = _create_oc(
        client, superuser_token_headers, supp_b["id"], product["id"], "160.00"
    )
    suggestions = doc["cost_change_suggestions"]
    assert len(suggestions) == 1
    assert suggestions[0]["previous_cost"] == "100.00"
    assert suggestions[0]["suggested_cost"] == "160.00"
    assert suggestions[0]["is_reference"] is False


def test_no_suggestion_when_cost_drops_or_is_unchanged(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    supplier = _create_supplier(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)
    _create_pair(
        client, superuser_token_headers, supplier["id"], product["id"], "100.00"
    )

    for precio in ("90.00", "100.00"):
        doc = _create_oc(
            client, superuser_token_headers, supplier["id"], product["id"], precio
        )
        assert doc["cost_change_suggestions"] == []


def test_sale_never_suggests_cost_changes(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    supplier = _create_supplier(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)
    _create_pair(
        client, superuser_token_headers, supplier["id"], product["id"], "100.00"
    )
    load_stock(client, superuser_token_headers, product["id"], "5")

    tck = _doc_type_id(client, superuser_token_headers, "TCK")
    r = client.post(
        f"{settings.API_V1_STR}/documents/",
        headers=superuser_token_headers,
        json={
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "lines": [
                {"product_id": product["id"], "cantidad": "1", "precio_unit": "130.00"}
            ],
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["cost_change_suggestions"] == []


def test_reference_cost_suggestion_and_manual_confirmation(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    supplier = _create_supplier(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)
    _create_pair(
        client,
        superuser_token_headers,
        supplier["id"],
        product["id"],
        "100.00",
        es_referencia=True,
    )
    assert db.get(Product, product["id"]).costo_actual == Decimal("100.00")

    doc = _create_oc(
        client, superuser_token_headers, supplier["id"], product["id"], "130.00"
    )
    assert doc["cost_change_suggestions"][0]["is_reference"] is True

    # the user confirms by updating the pair; reference propagation applies it
    r = client.patch(
        _pair_url(supplier["id"], product["id"]),
        headers=superuser_token_headers,
        json={"costo_actual": "130.00"},
    )
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["costo_anterior"] == "100.00"
    assert db.get(Product, product["id"]).costo_actual == Decimal("130.00")
    assert db.get(Product, product["id"]).precio_venta == Decimal("157.30")


def test_first_registered_pair_auto_promotes_to_reference(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    supplier = _create_supplier(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)  # cost 100

    # registering the first supplier cost with no reference in place promotes
    # the pair and syncs the product cost + sale price
    pair = _create_pair(
        client, superuser_token_headers, supplier["id"], product["id"], "150.00"
    )
    assert pair["es_referencia"] is True
    assert db.get(Product, product["id"]).costo_actual == Decimal("150.00")
    assert db.get(Product, product["id"]).precio_venta == Decimal("181.50")


def test_first_purchase_apply_creates_pair_as_reference(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    supplier = _create_supplier(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)  # cost 100

    doc = _create_oc(
        client, superuser_token_headers, supplier["id"], product["id"], "130.00"
    )
    assert doc["cost_change_suggestions"][0]["previous_cost"] is None

    # the frontend confirms a first purchase by creating the pair
    r = client.post(
        f"{settings.API_V1_STR}/supplier-products/",
        headers=superuser_token_headers,
        json={
            "supplier_id": supplier["id"],
            "product_id": product["id"],
            "costo_actual": "130.00",
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["es_referencia"] is True
    assert db.get(Product, product["id"]).costo_actual == Decimal("130.00")
    assert db.get(Product, product["id"]).precio_venta == Decimal("157.30")


def test_non_reference_pair_does_not_steal_existing_reference(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    supp_a = _create_supplier(client, superuser_token_headers)
    supp_b = _create_supplier(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)
    _create_pair(
        client, superuser_token_headers, supp_a["id"], product["id"], "200.00"
    )  # auto-promoted as the first pair
    assert db.get(Product, product["id"]).costo_actual == Decimal("200.00")

    # a later pair stays non-reference and a cost-only update must not move
    # the product cost or steal the reference flag (the buy screen sends
    # es_referencia=true explicitly when the user confirms a suggestion)
    _create_pair(client, superuser_token_headers, supp_b["id"], product["id"], "150.00")
    r = client.patch(
        _pair_url(supp_b["id"], product["id"]),
        headers=superuser_token_headers,
        json={"costo_actual": "220.00"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["es_referencia"] is False
    assert db.get(Product, product["id"]).costo_actual == Decimal("200.00")
    flags = {
        pair["supplier_id"]: pair["es_referencia"]
        for pair in _product_costs(client, superuser_token_headers, product["id"])
    }
    assert flags[supp_a["id"]] is True
    assert flags[supp_b["id"]] is False


def test_apply_payload_promotes_pair_to_reference(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    """The buy screen confirms a suggestion with es_referencia=true, which
    replaces any previous reference and syncs product cost + sale price."""
    supp_a = _create_supplier(client, superuser_token_headers)
    supp_b = _create_supplier(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)
    _create_pair(
        client, superuser_token_headers, supp_a["id"], product["id"], "200.00"
    )  # auto-promoted as the first pair
    _create_pair(client, superuser_token_headers, supp_b["id"], product["id"], "150.00")

    r = client.patch(
        _pair_url(supp_b["id"], product["id"]),
        headers=superuser_token_headers,
        json={"costo_actual": "250.00", "es_referencia": True},
    )
    assert r.status_code == 200, r.text
    assert r.json()["es_referencia"] is True
    assert db.get(Product, product["id"]).costo_actual == Decimal("250.00")
    assert db.get(Product, product["id"]).precio_venta == Decimal("302.50")
    flags = {
        pair["supplier_id"]: pair["es_referencia"]
        for pair in _product_costs(client, superuser_token_headers, product["id"])
    }
    assert flags[supp_a["id"]] is False
    assert flags[supp_b["id"]] is True
