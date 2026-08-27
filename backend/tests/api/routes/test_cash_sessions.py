"""Tests for the daily cash session (caja diaria) module."""

from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.models import PaymentMethod, User
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


def _cash_method_id(db: Session) -> str:
    method = db.exec(
        select(PaymentMethod).where(PaymentMethod.name == "Efectivo")
    ).first()
    assert method is not None, "Seeded cash payment method not found"
    return str(method.id)


def _credit_method_id(db: Session) -> str:
    method = db.exec(
        select(PaymentMethod).where(PaymentMethod.name == "Crédito")
    ).first()
    assert method is not None, "Seeded credit payment method not found"
    return str(method.id)


def _cash_account_id(client: TestClient, headers: dict[str, str]) -> str:
    r = client.get(
        f"{settings.API_V1_STR}/financial-accounts/",
        headers=headers,
        params={"limit": 100},
    )
    assert r.status_code == 200, r.text
    return next(a["id"] for a in r.json()["data"] if a["name"] == "Caja Principal")


def _current_session(client: TestClient, headers: dict[str, str]) -> dict | None:
    r = client.get(f"{settings.API_V1_STR}/cash-sessions/current", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _close_current_session(client: TestClient, headers: dict[str, str]) -> str:
    session = _current_session(client, headers)
    assert session is not None, "Expected an open session to close"
    r = client.post(
        f"{settings.API_V1_STR}/cash-sessions/{session['id']}/close",
        headers=headers,
        json={"counted_amount": "0"},
    )
    assert r.status_code == 200, r.text
    return session["id"]


def test_open_close_lifecycle(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    # A session is already open by the autouse fixture; double open is rejected.
    r = client.post(
        f"{settings.API_V1_STR}/cash-sessions/open",
        headers=superuser_token_headers,
        json={"opening_amount": "1000.00"},
    )
    assert r.status_code == 400, r.text
    assert r.json()["detail"]["code"] == "cash_session_already_open"

    session = _current_session(client, superuser_token_headers)
    assert session is not None
    assert session["status"] == "open"

    r = client.post(
        f"{settings.API_V1_STR}/cash-sessions/{session['id']}/close",
        headers=superuser_token_headers,
        json={"counted_amount": "0", "notes": "empty day"},
    )
    assert r.status_code == 200, r.text
    closed = r.json()
    assert closed["status"] == "closed"
    assert closed["closed_at"] is not None
    assert closed["closed_by_name"] is not None
    assert Decimal(closed["expected_amount"]) == Decimal("0")
    assert Decimal(closed["difference"]) == Decimal("0")

    # Reopen is allowed after closing.
    r = client.post(
        f"{settings.API_V1_STR}/cash-sessions/open",
        headers=superuser_token_headers,
        json={"opening_amount": "500.00"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "open"
    assert Decimal(r.json()["opening_amount"]) == Decimal("500.00")


def test_sale_requires_open_session(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "1")
    customer = _create_customer(client, superuser_token_headers)
    _close_current_session(client, superuser_token_headers)

    # No open session -> sales are blocked.
    r = client.post(
        f"{settings.API_V1_STR}/documents/",
        headers=superuser_token_headers,
        json={
            "document_type_id": _doc_type_id(client, superuser_token_headers, "TCK"),
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],
            "payments": [{"payment_method_id": _cash_method_id(db), "monto": "121.00"}],
        },
    )
    assert r.status_code == 400, r.text
    assert r.json()["detail"]["code"] == "cash_session_required"

    # Open and retry: the sale is linked to the session.
    r = client.post(
        f"{settings.API_V1_STR}/cash-sessions/open",
        headers=superuser_token_headers,
        json={"opening_amount": "100.00"},
    )
    assert r.status_code == 200, r.text
    session_id = r.json()["id"]
    doc = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": _doc_type_id(client, superuser_token_headers, "TCK"),
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],
            "payments": [{"payment_method_id": _cash_method_id(db), "monto": "121.00"}],
        },
    )
    assert doc["cash_session_id"] == session_id


def test_quote_and_purchase_do_not_require_session(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "1")
    customer = _create_customer(client, superuser_token_headers)
    supplier = _create_supplier(client, superuser_token_headers)
    _close_current_session(client, superuser_token_headers)

    quote = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": _doc_type_id(client, superuser_token_headers, "COT"),
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],
        },
    )
    assert quote["cash_session_id"] is None

    purchase = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": _doc_type_id(client, superuser_token_headers, "OC"),
            "contraparte_id": supplier["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],
            "payments": [{"payment_method_id": _cash_method_id(db), "monto": "121.00"}],
        },
    )
    assert purchase["cash_session_id"] is None


def test_report_expected_math_with_transfer(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "1")
    customer = _create_customer(client, superuser_token_headers)
    session_id = _close_current_session(client, superuser_token_headers)

    r = client.post(
        f"{settings.API_V1_STR}/cash-sessions/open",
        headers=superuser_token_headers,
        json={"opening_amount": "1000.00"},
    )
    assert r.status_code == 200, r.text
    session_id = r.json()["id"]

    _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": _doc_type_id(client, superuser_token_headers, "TCK"),
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],
            "payments": [{"payment_method_id": _cash_method_id(db), "monto": "121.00"}],
        },
    )

    # Drawer deposit: cash -> bank, linked to the session (vuelco).
    bank = client.post(
        f"{settings.API_V1_STR}/financial-accounts/",
        headers=superuser_token_headers,
        json={"name": random_lower_string()[:20]},
    ).json()
    r = client.post(
        f"{settings.API_V1_STR}/transfers/",
        headers=superuser_token_headers,
        json={
            "from_account_id": _cash_account_id(client, superuser_token_headers),
            "to_account_id": bank["id"],
            "monto": "500.00",
            "descripcion": "deposit",
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["cash_session_id"] == session_id

    report = client.get(
        f"{settings.API_V1_STR}/cash-sessions/{session_id}/report",
        headers=superuser_token_headers,
    )
    assert report.status_code == 200, report.text
    data = report.json()
    assert Decimal(data["expected_amount"]) == Decimal("621.00")
    # sales per user
    assert len(data["sales"]) == 1
    assert data["sales"][0]["count"] == 1
    assert Decimal(data["sales"][0]["total"]) == Decimal("121.00")
    # payment-method control table
    cash_row = next(
        m for m in data["methods"] if m["payment_method_name"] == "Efectivo"
    )
    assert Decimal(cash_row["ingresos"]) == Decimal("121.00")
    assert Decimal(cash_row["net"]) == Decimal("121.00")
    # money movements include the transfer
    assert any(m["concept"] == "Transfer" for m in data["movements"])

    # Close with the physical count (drawer holds float + 121 - 500 deposit).
    r = client.post(
        f"{settings.API_V1_STR}/cash-sessions/{session_id}/close",
        headers=superuser_token_headers,
        json={"counted_amount": "621.00"},
    )
    assert r.status_code == 200, r.text
    assert Decimal(r.json()["difference"]) == Decimal("0.00")


def test_receipt_session_checkbox(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    session = _current_session(client, superuser_token_headers)
    assert session is not None

    # RC with the session link: counts in the cierre (cash into the drawer).
    r = client.post(
        f"{settings.API_V1_STR}/payments/",
        headers=superuser_token_headers,
        json={
            "contraparte_type": "customer",
            "contraparte_id": customer["id"],
            "payments": [{"payment_method_id": _cash_method_id(db), "monto": "50.00"}],
            "cash_session_id": session["id"],
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["document"]["cash_session_id"] == session["id"]

    # Another RC without the link: only the financial account, out of the cierre.
    r = client.post(
        f"{settings.API_V1_STR}/payments/",
        headers=superuser_token_headers,
        json={
            "contraparte_type": "customer",
            "contraparte_id": customer["id"],
            "payments": [{"payment_method_id": _cash_method_id(db), "monto": "30.00"}],
            "cash_session_id": None,
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["document"]["cash_session_id"] is None

    report = client.get(
        f"{settings.API_V1_STR}/cash-sessions/{session['id']}/report",
        headers=superuser_token_headers,
    ).json()
    assert len(report["receipts_collected"]) == 1
    assert Decimal(report["receipts_collected"][0]["total"]) == Decimal("50.00")
    assert Decimal(report["expected_amount"]) == Decimal("50.00")


def test_receipt_rejects_unknown_or_closed_session(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    session = _current_session(client, superuser_token_headers)
    assert session is not None
    closed_id = _close_current_session(client, superuser_token_headers)

    r = client.post(
        f"{settings.API_V1_STR}/payments/",
        headers=superuser_token_headers,
        json={
            "contraparte_type": "customer",
            "contraparte_id": customer["id"],
            "payments": [{"payment_method_id": _cash_method_id(db), "monto": "10.00"}],
            "cash_session_id": closed_id,
        },
    )
    assert r.status_code == 400, r.text
    assert r.json()["detail"]["code"] == "cash_session_already_closed"

    r = client.post(
        f"{settings.API_V1_STR}/payments/",
        headers=superuser_token_headers,
        json={
            "contraparte_type": "customer",
            "contraparte_id": customer["id"],
            "payments": [{"payment_method_id": _cash_method_id(db), "monto": "10.00"}],
            "cash_session_id": "00000000-0000-0000-0000-000000000000",
        },
    )
    assert r.status_code == 400, r.text
    assert r.json()["detail"]["code"] == "cash_session_not_found"


def test_credit_sale_counts_in_methods_but_not_drawer(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "1")
    customer = _create_customer(client, superuser_token_headers)
    session = _current_session(client, superuser_token_headers)
    assert session is not None

    _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": _doc_type_id(client, superuser_token_headers, "TCK"),
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],  # 121.00
            "payments": [
                {"payment_method_id": _credit_method_id(db), "monto": "121.00"}
            ],
        },
    )

    report = client.get(
        f"{settings.API_V1_STR}/cash-sessions/{session['id']}/report",
        headers=superuser_token_headers,
    ).json()
    # Expected drawer untouched (credit is not drawer cash)...
    assert Decimal(report["expected_amount"]) == Decimal("0.00")
    # ...but the method control table still shows the credit sale.
    credit_row = next(
        m for m in report["methods"] if m["payment_method_name"] == "Crédito"
    )
    assert Decimal(credit_row["ingresos"]) == Decimal("121.00")


def test_open_requires_permission(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = client.get(
        f"{settings.API_V1_STR}/cash-sessions/current",
        headers=normal_user_token_headers,
    )
    assert r.status_code == 403
    r = client.post(
        f"{settings.API_V1_STR}/cash-sessions/open",
        headers=normal_user_token_headers,
        json={"opening_amount": "100.00"},
    )
    assert r.status_code == 403


def test_session_history(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    _close_current_session(client, superuser_token_headers)
    r = client.post(
        f"{settings.API_V1_STR}/cash-sessions/open",
        headers=superuser_token_headers,
        json={"opening_amount": "100.00"},
    )
    assert r.status_code == 200
    _close_current_session(client, superuser_token_headers)

    r = client.get(
        f"{settings.API_V1_STR}/cash-sessions/",
        headers=superuser_token_headers,
        params={"limit": 100},
    )
    assert r.status_code == 200, r.text
    assert r.json()["count"] >= 2
    statuses = {s["status"] for s in r.json()["data"]}
    assert "closed" in statuses

    r = client.get(
        f"{settings.API_V1_STR}/cash-sessions/",
        headers=superuser_token_headers,
        params={"status": "open", "limit": 100},
    )
    assert r.status_code == 200, r.text
    assert all(s["status"] == "open" for s in r.json()["data"])


def test_open_with_external_source_funds_drawer(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    other = client.post(
        f"{settings.API_V1_STR}/financial-accounts/",
        headers=superuser_token_headers,
        json={"name": random_lower_string()[:20]},
    ).json()
    _close_current_session(client, superuser_token_headers)

    r = client.post(
        f"{settings.API_V1_STR}/cash-sessions/open",
        headers=superuser_token_headers,
        json={"opening_amount": "500.00", "opening_source_account_id": other["id"]},
    )
    assert r.status_code == 200, r.text
    session_id = r.json()["id"]
    assert r.json()["opening_source_account_id"] == other["id"]

    # A funding movement moved the float into the drawer account.
    r = client.get(
        f"{settings.API_V1_STR}/cash-sessions/{session_id}/report",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200, r.text
    assert any(m["concept"] == "Opening float funding" for m in r.json()["movements"])


def test_cash_methods_flagged_as_drawer(db: Session) -> None:
    cash = db.exec(select(PaymentMethod).where(PaymentMethod.name == "Efectivo")).one()
    assert cash.is_cash_drawer is True
    credit = db.exec(select(PaymentMethod).where(PaymentMethod.name == "Crédito")).one()
    assert credit.is_cash_drawer is False


def test_closing_user_recorded(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    session = _current_session(client, superuser_token_headers)
    assert session is not None
    opener = db.exec(select(User).where(User.email == settings.FIRST_SUPERUSER)).one()
    assert session["opened_by_name"] == opener.full_name or opener.email
    r = client.post(
        f"{settings.API_V1_STR}/cash-sessions/{session['id']}/close",
        headers=superuser_token_headers,
        json={"counted_amount": "0"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["closed_by_name"] == opener.full_name or opener.email
