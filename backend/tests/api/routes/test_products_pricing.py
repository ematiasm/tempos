"""Tests for the margin-over-net pricing chain (precio_neto / precio_venta)."""


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


def _tax_id(client: TestClient, headers: dict[str, str], code: str) -> str:
    r = client.get(
        f"{settings.API_V1_STR}/taxes/", headers=headers, params={"limit": 100}
    )
    assert r.status_code == 200
    return next(row for row in r.json()["data"] if row["code"] == code)["id"]


def _create_fixed_tax(client: TestClient, headers: dict[str, str]) -> str:
    """Create a fixed-amount (is_percent=false) line tax of 2.00."""
    r = client.post(
        f"{settings.API_V1_STR}/taxes/",
        headers=headers,
        json={
            "name": random_lower_string()[:12],
            "code": "F" + random_lower_string()[:7].upper(),
            "tipo": "Otro",
            "rate": "2.00",
            "is_percent": False,
            "aplica_a": "linea",
            "is_active": True,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _set_price_rounding(client: TestClient, headers: dict[str, str], mode: str) -> None:
    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=headers,
        json={"price_rounding": mode},
    )
    assert r.status_code == 200, r.text
    assert r.json()["price_rounding"] == mode


def _create_product(
    client: TestClient,
    headers: dict[str, str],
    *,
    costo: str = "100.00",
    margen: str = "50.00",
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


def test_chain_margen_over_neto_with_iva21(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """costo 100 / margen 50 / IVA 21% / none → neto 150.00, venta 181.50."""
    iva21 = _tax_id(client, superuser_token_headers, "IVA21")
    product = _create_product(
        client, superuser_token_headers, tax_ids=[iva21]
    )
    assert product["precio_neto"] == "150.00"
    assert product["precio_venta"] == "181.50"


def test_chain_percent_and_fixed_coexist(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """Fixed 2.00 is added once, outside the percent math: 150 + 31.50 + 2."""
    iva21 = _tax_id(client, superuser_token_headers, "IVA21")
    fixed = _create_fixed_tax(client, superuser_token_headers)
    product = _create_product(
        client, superuser_token_headers, tax_ids=[iva21, fixed]
    )
    assert product["precio_neto"] == "150.00"
    assert product["precio_venta"] == "183.50"


def test_chain_no_taxes_gondola_equals_neto(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    product = _create_product(client, superuser_token_headers)
    assert product["precio_neto"] == "150.00"
    assert product["precio_venta"] == "150.00"


def _create_supplier(client: TestClient, headers: dict[str, str]) -> dict:
    r = client.post(
        f"{settings.API_V1_STR}/suppliers/",
        headers=headers,
        json={"razon_social": random_lower_string()[:20], "condicion_fiscal": "RI"},
    )
    assert r.status_code == 200, r.text
    return r.json()


def _confirm_reference_cost(
    client: TestClient, headers: dict[str, str], product_id: str, costo: str
) -> None:
    """Register a reference supplier cost and confirm it via PATCH."""
    supplier = _create_supplier(client, headers)
    r = client.post(
        f"{settings.API_V1_STR}/supplier-products/",
        headers=headers,
        json={
            "supplier_id": supplier["id"],
            "product_id": product_id,
            "costo_actual": costo,
        },
    )
    assert r.status_code == 200, r.text
    r = client.patch(
        f"{settings.API_V1_STR}/supplier-products/{supplier['id']}/{product_id}",
        headers=headers,
        json={"costo_actual": costo},
    )
    assert r.status_code == 200, r.text


def _read_product(
    client: TestClient, headers: dict[str, str], product_id: str
) -> dict:
    r = client.get(
        f"{settings.API_V1_STR}/products/{product_id}", headers=headers
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_rounding_modes_apply_only_to_gondola(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """Rounding modes shape only precio_venta; neto/costo stay exact 2-dec.

    Raw gondola = 181.50 for the standard chain (costo 100 / margen 50 / IVA 21).
    """
    iva21 = _tax_id(client, superuser_token_headers, "IVA21")

    # none → raw value
    _set_price_rounding(client, superuser_token_headers, "none")
    p_none = _create_product(client, superuser_token_headers, tax_ids=[iva21])
    assert p_none["precio_neto"] == "150.00"
    assert p_none["precio_venta"] == "181.50"

    # two_decimals → same plain 2-dec result
    _set_price_rounding(client, superuser_token_headers, "two_decimals")
    p_two = _create_product(client, superuser_token_headers, tax_ids=[iva21])
    assert p_two["precio_neto"] == "150.00"
    assert p_two["precio_venta"] == "181.50"

    # psychological_90 → 181.50 rounds UP to 181.90
    _set_price_rounding(client, superuser_token_headers, "psychological_90")
    p_90 = _create_product(client, superuser_token_headers, tax_ids=[iva21])
    assert p_90["precio_neto"] == "150.00"
    assert p_90["precio_venta"] == "181.90"

    _set_price_rounding(client, superuser_token_headers, "none")


def test_recompute_cost_change_via_reference_confirmation(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """costo 200 → neto 300, venta 363.00 (chain from inputs, none mode)."""
    iva21 = _tax_id(client, superuser_token_headers, "IVA21")
    product = _create_product(client, superuser_token_headers, tax_ids=[iva21])
    _confirm_reference_cost(
        client, superuser_token_headers, product["id"], "200.00"
    )
    updated = _read_product(client, superuser_token_headers, product["id"])
    assert updated["costo_actual"] == "200.00"
    assert updated["precio_neto"] == "300.00"
    assert updated["precio_venta"] == "363.00"


def test_recompute_idempotent_under_psychological_90(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """363.00 → 363.90 stable across repeated recomputes (never compounded)."""
    iva21 = _tax_id(client, superuser_token_headers, "IVA21")
    _set_price_rounding(client, superuser_token_headers, "psychological_90")
    product = _create_product(client, superuser_token_headers, tax_ids=[iva21])
    assert product["precio_venta"] == "181.90"
    # second recompute from the same inputs stays at the same góndola
    _confirm_reference_cost(
        client, superuser_token_headers, product["id"], "100.00"
    )
    updated = _read_product(client, superuser_token_headers, product["id"])
    assert updated["costo_actual"] == "100.00"
    assert updated["precio_neto"] == "150.00"
    assert updated["precio_venta"] == "181.90"
    _set_price_rounding(client, superuser_token_headers, "none")


def test_patch_tax_ids_alone_triggers_gondola_recompute(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """Assigning taxes via PATCH reprices the góndola without touching prices."""
    iva21 = _tax_id(client, superuser_token_headers, "IVA21")
    product = _create_product(client, superuser_token_headers)
    assert product["precio_venta"] == "150.00"
    r = client.patch(
        f"{settings.API_V1_STR}/products/{product['id']}",
        headers=superuser_token_headers,
        json={"tax_ids": [iva21]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["precio_neto"] == "150.00"
    assert r.json()["precio_venta"] == "181.50"


def test_second_iva_tax_rejected(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    iva21 = _tax_id(client, superuser_token_headers, "IVA21")
    iva105 = _tax_id(client, superuser_token_headers, "IVA105")
    product = _create_product(client, superuser_token_headers, tax_ids=[iva21])
    r = client.patch(
        f"{settings.API_V1_STR}/products/{product['id']}",
        headers=superuser_token_headers,
        json={"tax_ids": [iva21, iva105]},
    )
    assert r.status_code == 400
    detail = r.json()["detail"]
    assert detail["code"] == "multiple_iva_taxes"
    # no partial assignment: the product keeps exactly the original taxes
    updated = _read_product(client, superuser_token_headers, product["id"])
    assert [t["id"] for t in updated["taxes"]] == [iva21]


def test_second_iva_rejected_on_create(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    iva21 = _tax_id(client, superuser_token_headers, "IVA21")
    iva105 = _tax_id(client, superuser_token_headers, "IVA105")
    r = client.post(
        f"{settings.API_V1_STR}/products/",
        headers=superuser_token_headers,
        json={
            "name": random_lower_string()[:20],
            "uom_id": _create_uom(client, superuser_token_headers)["id"],
            "margen_pct": "50.00",
            "costo_actual": "100.00",
            "tax_ids": [iva21, iva105],
        },
    )
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "multiple_iva_taxes"


def test_exento_alone_accepted_zero_percent_chain(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    exento = _tax_id(client, superuser_token_headers, "EXENTO")
    product = _create_product(
        client, superuser_token_headers, tax_ids=[exento]
    )
    assert product["precio_neto"] == "150.00"
    assert product["precio_venta"] == "150.00"


def test_exento_plus_iva_rejected(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    exento = _tax_id(client, superuser_token_headers, "EXENTO")
    iva21 = _tax_id(client, superuser_token_headers, "IVA21")
    product = _create_product(client, superuser_token_headers, tax_ids=[exento])
    r = client.patch(
        f"{settings.API_V1_STR}/products/{product['id']}",
        headers=superuser_token_headers,
        json={"tax_ids": [exento, iva21]},
    )
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "multiple_iva_taxes"
    updated = _read_product(client, superuser_token_headers, product["id"])
    assert [t["id"] for t in updated["taxes"]] == [exento]


def test_iibb_coexists_with_single_iva(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    iva21 = _tax_id(client, superuser_token_headers, "IVA21")
    r = client.post(
        f"{settings.API_V1_STR}/taxes/",
        headers=superuser_token_headers,
        json={
            "name": "IIBB CABA",
            "code": "IIBB3",
            "tipo": "IIBB",
            "rate": "3.00",
            "is_percent": True,
            "aplica_a": "linea",
            "is_active": True,
        },
    )
    assert r.status_code == 200, r.text
    iibb = r.json()["id"]
    product = _create_product(
        client, superuser_token_headers, tax_ids=[iva21, iibb]
    )
    # 150.00 neto + 21% + 3% (both percent over the neto) = 186.00
    assert product["precio_neto"] == "150.00"
    assert product["precio_venta"] == "186.00"


def test_costo_con_impuestos_derivation(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """costo_con_impuestos = costo + IVA over cost; reflects tax PATCH without
    any product price edit."""
    iva21 = _tax_id(client, superuser_token_headers, "IVA21")
    product = _create_product(client, superuser_token_headers, tax_ids=[iva21])
    assert product["costo_con_impuestos"] == "121.00"
    # switch the IVA assignment 21% → 10.5%: 100 + 10.50
    iva105 = _tax_id(client, superuser_token_headers, "IVA105")
    r = client.patch(
        f"{settings.API_V1_STR}/products/{product['id']}",
        headers=superuser_token_headers,
        json={"tax_ids": [iva105]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["costo_con_impuestos"] == "110.50"
    # no IVA / exento → 0.00
    exento = _tax_id(client, superuser_token_headers, "EXENTO")
    r = client.patch(
        f"{settings.API_V1_STR}/products/{product['id']}",
        headers=superuser_token_headers,
        json={"tax_ids": [exento]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["costo_con_impuestos"] == "0.00"
    plain = _create_product(client, superuser_token_headers)
    assert plain["costo_con_impuestos"] == "0.00"
