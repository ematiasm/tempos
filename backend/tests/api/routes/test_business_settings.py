"""Tests for the /business-settings endpoints (singleton)."""

import io

from fastapi.testclient import TestClient
from sqlmodel import Session, delete, select

from app.core.config import settings
from app.models import BusinessSettings
from tests.utils.utils import random_lower_string


def test_public_locale_is_readable_without_authentication(client: TestClient) -> None:
    """Login, reset and sign-up need the language before any credential exists."""
    r = client.get(f"{settings.API_V1_STR}/business-settings/locale")
    assert r.status_code == 200, r.text
    assert r.json()["default_locale"] in ("es", "en")


def test_public_locale_on_a_fresh_install_answers_the_default(
    client: TestClient, db: Session
) -> None:
    """It reports the default and must never complete setup by creating the row."""
    db.execute(delete(BusinessSettings))
    db.commit()

    r = client.get(f"{settings.API_V1_STR}/business-settings/locale")
    assert r.status_code == 200, r.text
    assert r.json()["default_locale"] == "en"
    assert db.exec(select(BusinessSettings)).first() is None


def test_public_locale_follows_the_stored_value(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={"default_locale": "es"},
    )
    assert r.status_code == 200, r.text

    r = client.get(f"{settings.API_V1_STR}/business-settings/locale")
    assert r.status_code == 200, r.text
    assert r.json()["default_locale"] == "es"


def test_read_business_settings_singleton(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.get(
        f"{settings.API_V1_STR}/business-settings/", headers=superuser_token_headers
    )
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == 1
    assert body["allow_negative_stock"] is False
    assert body["enable_variants"] is False
    assert body["stock_policy"] in ("block", "warn")
    assert body["default_locale"] in ("es", "en")


def test_number_format_setting_removed(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """number_format was removed: the business default_locale drives all formats."""
    r = client.get(
        f"{settings.API_V1_STR}/business-settings/", headers=superuser_token_headers
    )
    assert r.status_code == 200
    assert "number_format" not in r.json()


def test_update_business_settings(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    new_name = random_lower_string()[:15]
    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={
            "business_name": new_name,
            "condicion_fiscal": "RI",
            "allow_negative_stock": True,
            "cuit": "30-12345678-9",
        },
    )
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["business_name"] == new_name
    assert updated["condicion_fiscal"] == "RI"
    assert updated["allow_negative_stock"] is True
    assert updated["cuit"] == "30-12345678-9"

    # restore safe defaults so other tests keep their assumptions
    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={"allow_negative_stock": False, "condicion_fiscal": "Consumidor Final"},
    )
    assert r.status_code == 200


def test_update_new_configuration_fields(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    payment_methods = client.get(
        f"{settings.API_V1_STR}/payment-methods/", headers=superuser_token_headers
    ).json()["data"]
    assert payment_methods
    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={
            "stock_policy": "block",
            "default_locale": "es",
            "payment_method_default_id": payment_methods[0]["id"],
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["stock_policy"] == "block"
    assert body["default_locale"] == "es"
    assert body["payment_method_default_id"] == payment_methods[0]["id"]

    # restore defaults
    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={
            "stock_policy": "warn",
            "default_locale": "en",
            "payment_method_default_id": None,
        },
    )
    assert r.status_code == 200, r.text


def test_fresh_settings_have_empty_print_texts(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.get(
        f"{settings.API_V1_STR}/business-settings/", headers=superuser_token_headers
    )
    assert r.status_code == 200
    body = r.json()
    assert body["default_print_format"] == "a4"
    assert body["voucher_footer"] is None
    assert body["voucher_legends"] is None


def test_print_settings_round_trip(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={
            "default_print_format": "ticket80",
            "voucher_footer": "Thanks for your purchase",
            "voucher_legends": "First line\nSecond line",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["default_print_format"] == "ticket80"
    assert body["voucher_footer"] == "Thanks for your purchase"
    assert body["voucher_legends"] == "First line\nSecond line"

    # values persist on a fresh read
    r = client.get(
        f"{settings.API_V1_STR}/business-settings/", headers=superuser_token_headers
    )
    assert r.status_code == 200
    body = r.json()
    assert body["default_print_format"] == "ticket80"
    assert body["voucher_footer"] == "Thanks for your purchase"
    assert body["voucher_legends"] == "First line\nSecond line"

    # restore defaults
    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={
            "default_print_format": "a4",
            "voucher_footer": None,
            "voucher_legends": None,
        },
    )
    assert r.status_code == 200, r.text


def test_print_settings_length_limits(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={"voucher_footer": "x" * 256},
    )
    assert r.status_code == 422
    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={"voucher_legends": "x" * 501},
    )
    assert r.status_code == 422
    # boundary values are accepted
    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={"voucher_footer": "x" * 255, "voucher_legends": "x" * 500},
    )
    assert r.status_code == 200, r.text
    # restore defaults
    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={"voucher_footer": None, "voucher_legends": None},
    )
    assert r.status_code == 200


def test_fresh_settings_have_price_rounding_default_none(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.get(
        f"{settings.API_V1_STR}/business-settings/", headers=superuser_token_headers
    )
    assert r.status_code == 200
    assert r.json()["price_rounding"] == "none"


def test_price_rounding_round_trip(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    for mode in ("none", "two_decimals", "psychological_90"):
        r = client.patch(
            f"{settings.API_V1_STR}/business-settings/",
            headers=superuser_token_headers,
            json={"price_rounding": mode},
        )
        assert r.status_code == 200, r.text
        assert r.json()["price_rounding"] == mode
        # the value persists on a fresh read
        r = client.get(
            f"{settings.API_V1_STR}/business-settings/",
            headers=superuser_token_headers,
        )
        assert r.status_code == 200
        assert r.json()["price_rounding"] == mode
    # restore default
    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={"price_rounding": "none"},
    )
    assert r.status_code == 200


def test_price_rounding_invalid_value_rejected(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={"price_rounding": "bogus_mode"},
    )
    assert r.status_code == 422


def test_fresh_settings_have_default_sell_config(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.get(
        f"{settings.API_V1_STR}/business-settings/", headers=superuser_token_headers
    )
    assert r.status_code == 200
    body = r.json()
    assert body["sell_quick_method_ids"] is None
    assert body["sell_default_document_type_id"] is None
    assert body["sell_default_customer_id"] is None
    # price editing is blocked by default; the date selector is shown
    assert body["sell_block_price_edit"] is True
    assert body["sell_hide_date"] is False


def test_sell_config_round_trip(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    payment_methods = client.get(
        f"{settings.API_V1_STR}/payment-methods/", headers=superuser_token_headers
    ).json()["data"]
    assert payment_methods
    document_types = client.get(
        f"{settings.API_V1_STR}/document-types/", headers=superuser_token_headers
    ).json()["data"]
    customers = client.get(
        f"{settings.API_V1_STR}/customers/", headers=superuser_token_headers
    ).json()["data"]
    assert document_types
    assert customers

    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={
            "sell_quick_method_ids": [payment_methods[0]["id"]],
            "sell_default_document_type_id": document_types[0]["id"],
            "sell_default_customer_id": customers[0]["id"],
            "sell_block_price_edit": False,
            "sell_hide_date": True,
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sell_quick_method_ids"] == [payment_methods[0]["id"]]
    assert body["sell_default_document_type_id"] == document_types[0]["id"]
    assert body["sell_default_customer_id"] == customers[0]["id"]
    assert body["sell_block_price_edit"] is False
    assert body["sell_hide_date"] is True

    # values persist on a fresh read
    r = client.get(
        f"{settings.API_V1_STR}/business-settings/", headers=superuser_token_headers
    )
    assert r.status_code == 200
    body = r.json()
    assert body["sell_block_price_edit"] is False
    assert body["sell_hide_date"] is True

    # restore defaults
    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={
            "sell_quick_method_ids": None,
            "sell_default_document_type_id": None,
            "sell_default_customer_id": None,
            "sell_block_price_edit": True,
            "sell_hide_date": False,
        },
    )
    assert r.status_code == 200, r.text


def test_sell_quick_method_ids_preserves_order(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    payment_methods = client.get(
        f"{settings.API_V1_STR}/payment-methods/", headers=superuser_token_headers
    ).json()["data"]
    assert len(payment_methods) >= 2
    ids = [m["id"] for m in payment_methods[:2]]
    ordered = [ids[1], ids[0]]  # reversed on purpose

    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={"sell_quick_method_ids": ordered},
    )
    assert r.status_code == 200, r.text
    assert r.json()["sell_quick_method_ids"] == ordered

    # restore defaults
    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={"sell_quick_method_ids": None},
    )
    assert r.status_code == 200, r.text


def test_fresh_settings_have_print_margin_defaults(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.get(
        f"{settings.API_V1_STR}/business-settings/", headers=superuser_token_headers
    )
    assert r.status_code == 200
    body = r.json()
    assert body["print_margin_a4_mm"] == 12
    assert body["print_margin_ticket_mm"] == 4
    assert body["print_margin_report_mm"] == 10


def test_print_margins_round_trip(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={"print_margin_a4_mm": 20, "print_margin_ticket_mm": 0},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["print_margin_a4_mm"] == 20
    assert body["print_margin_ticket_mm"] == 0
    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={"print_margin_report_mm": 8},
    )
    assert r.status_code == 200, r.text
    assert r.json()["print_margin_report_mm"] == 8
    # values persist on a fresh read
    r = client.get(
        f"{settings.API_V1_STR}/business-settings/", headers=superuser_token_headers
    )
    assert r.status_code == 200
    body = r.json()
    assert body["print_margin_a4_mm"] == 20
    assert body["print_margin_ticket_mm"] == 0
    # restore defaults
    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={"print_margin_a4_mm": 12, "print_margin_ticket_mm": 4},
    )
    assert r.status_code == 200, r.text
    # restore the report margin too
    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={"print_margin_report_mm": 10},
    )
    assert r.status_code == 200, r.text


def test_print_margins_bounds_rejected(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={"print_margin_a4_mm": -1},
    )
    assert r.status_code == 422
    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={"print_margin_ticket_mm": 51},
    )
    assert r.status_code == 422
    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={"print_margin_report_mm": -1},
    )
    assert r.status_code == 422


def test_fresh_settings_have_product_defaults(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.get(
        f"{settings.API_V1_STR}/business-settings/", headers=superuser_token_headers
    )
    assert r.status_code == 200
    body = r.json()
    assert body["default_margen_pct"] is None
    assert body["warn_below_cost"] is False
    assert body["require_barcode"] is False
    assert body["default_uom_id"] is None


def test_product_defaults_round_trip(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.post(
        f"{settings.API_V1_STR}/uoms/",
        headers=superuser_token_headers,
        json={"name": "Test UoM Settings", "abbreviation": "tus", "decimal_places": 0},
    )
    assert r.status_code == 200, r.text
    uom = r.json()

    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={
            "default_margen_pct": 35.5,
            "warn_below_cost": True,
            "require_barcode": True,
            "default_uom_id": uom["id"],
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert float(body["default_margen_pct"]) == 35.5
    assert body["warn_below_cost"] is True
    assert body["require_barcode"] is True
    assert body["default_uom_id"] == uom["id"]

    # values persist on a fresh read
    r = client.get(
        f"{settings.API_V1_STR}/business-settings/", headers=superuser_token_headers
    )
    assert r.status_code == 200
    body = r.json()
    assert float(body["default_margen_pct"]) == 35.5
    assert body["warn_below_cost"] is True
    assert body["require_barcode"] is True
    assert body["default_uom_id"] == uom["id"]

    # restore defaults, then remove the helper uom
    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={
            "default_margen_pct": None,
            "warn_below_cost": False,
            "require_barcode": False,
            "default_uom_id": None,
        },
    )
    assert r.status_code == 200, r.text
    r = client.delete(
        f"{settings.API_V1_STR}/uoms/{uom['id']}", headers=superuser_token_headers
    )
    assert r.status_code == 200


def test_product_defaults_reject_invalid_uuid(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={"default_uom_id": "not-a-uuid"},
    )
    assert r.status_code == 422


def test_upload_and_delete_logo(
    client: TestClient, superuser_token_headers: dict[str, str], tmp_path, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path))
    r = client.post(
        f"{settings.API_V1_STR}/business-settings/logo",
        headers=superuser_token_headers,
        files={"file": ("logo.png", io.BytesIO(b"\x89PNG fake"), "image/png")},
    )
    assert r.status_code == 200, r.text
    assert r.json()["logo_path"] == "/uploads/logo.png"
    assert (tmp_path / "logo.png").is_file()

    r = client.delete(
        f"{settings.API_V1_STR}/business-settings/logo",
        headers=superuser_token_headers,
    )
    assert r.status_code == 204
    assert not (tmp_path / "logo.png").exists()
    body = client.get(
        f"{settings.API_V1_STR}/business-settings/", headers=superuser_token_headers
    ).json()
    assert body["logo_path"] is None


def test_upload_logo_rejects_bad_format(
    client: TestClient, superuser_token_headers: dict[str, str], tmp_path, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path))
    r = client.post(
        f"{settings.API_V1_STR}/business-settings/logo",
        headers=superuser_token_headers,
        files={"file": ("malware.exe", io.BytesIO(b"MZ"), "application/octet-stream")},
    )
    assert r.status_code == 400
    assert not any(tmp_path.iterdir())
