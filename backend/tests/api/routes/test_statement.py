"""Tests for counterpart account statements (estado de cuenta).

Covers the read-only GET statement endpoints (totals, documents with lines,
receipts, period filtering, permission gating) and the email endpoints
(disabled/missing-address/success/failure paths).
"""

import uuid
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app import crud
from app.core.config import settings
from app.models import PaymentMethod, UserCreate
from tests.utils.ledger import load_stock
from tests.utils.utils import random_email, random_lower_string


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


def _create_product(client: TestClient, headers: dict[str, str]) -> dict:
    uom = _create_uom(client, headers)
    r = client.post(
        f"{settings.API_V1_STR}/products/",
        headers=headers,
        json={
            "name": random_lower_string()[:20],
            "uom_id": uom["id"],
            "margen_pct": "21.00",
            "costo_actual": "100.00",
            "tax_ids": [],
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def _create_customer(
    client: TestClient, headers: dict[str, str], email: str | None = None
) -> dict:
    payload: dict[str, Any] = {
        "razon_social": random_lower_string()[:20],
        "condicion_fiscal": "RI",
    }
    if email is not None:
        payload["email"] = email
    r = client.post(f"{settings.API_V1_STR}/customers/", headers=headers, json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def _create_supplier(
    client: TestClient, headers: dict[str, str], email: str | None = None
) -> dict:
    payload: dict[str, Any] = {"razon_social": random_lower_string()[:20]}
    if email is not None:
        payload["email"] = email
    r = client.post(f"{settings.API_V1_STR}/suppliers/", headers=headers, json=payload)
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


def _cash_method_id(db: Session) -> str:
    method = db.exec(
        select(PaymentMethod).where(PaymentMethod.name == "Efectivo")
    ).first()
    assert method is not None, "Seeded cash payment method not found"
    return str(method.id)


def _create_sale(
    client: TestClient,
    headers: dict[str, str],
    product_id: str,
    customer_id: str,
    fecha: str | None = None,
) -> dict:
    load_stock(client, headers, product_id, "1")
    payload: dict[str, Any] = {
        "document_type_id": _doc_type_id(client, headers, "TCK"),
        "contraparte_id": customer_id,
        "lines": [{"product_id": product_id, "cantidad": "1"}],
    }
    if fecha is not None:
        payload["fecha"] = fecha
    r = client.post(f"{settings.API_V1_STR}/documents/", headers=headers, json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def _create_purchase(
    client: TestClient, headers: dict[str, str], product_id: str, supplier_id: str
) -> dict:
    r = client.post(
        f"{settings.API_V1_STR}/documents/",
        headers=headers,
        json={
            "document_type_id": _doc_type_id(client, headers, "OC"),
            "contraparte_id": supplier_id,
            "lines": [{"product_id": product_id, "cantidad": "2"}],
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def _create_receipt(
    client: TestClient,
    headers: dict[str, str],
    contraparte_type: str,
    contraparte_id: str,
    method_id: str,
    monto: str,
    fecha: str | None = None,
) -> dict:
    payload: dict[str, Any] = {
        "contraparte_type": contraparte_type,
        "contraparte_id": contraparte_id,
        "payments": [{"payment_method_id": method_id, "monto": monto}],
    }
    if fecha is not None:
        payload["fecha"] = fecha
    r = client.post(f"{settings.API_V1_STR}/payments/", headers=headers, json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def _void_document(client: TestClient, headers: dict[str, str], document_id: str) -> dict:
    r = client.post(
        f"{settings.API_V1_STR}/documents/{document_id}/void",
        headers=headers,
        json={"lines": [], "payments": []},
    )
    assert r.status_code == 200, r.text
    return r.json()


def _get_statement(
    client: TestClient, headers: dict[str, str], counterpart_type: str, id_: str, **params
) -> dict:
    r = client.get(
        f"{settings.API_V1_STR}/{counterpart_type}s/{id_}/statement",
        headers=headers,
        params=params or None,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _doc_by_numero(statement: dict, numero: str) -> dict:
    return next(d for d in statement["documents"] if d["numero"] == numero)


def test_customer_statement_totals_documents_and_lines(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    product = _create_product(client, superuser_token_headers)
    customer = _create_customer(client, superuser_token_headers, email=random_email())
    sale = _create_sale(
        client, superuser_token_headers, product["id"], customer["id"]
    )  # 121.00
    voided_sale = _create_sale(
        client, superuser_token_headers, product["id"], customer["id"]
    )  # 121.00
    nc = _void_document(client, superuser_token_headers, voided_sale["id"])
    receipt = _create_receipt(
        client,
        superuser_token_headers,
        "customer",
        customer["id"],
        _cash_method_id(db),
        "50.00",
    )

    statement = _get_statement(
        client, superuser_token_headers, "customer", customer["id"]
    )

    # Counterpart display info.
    assert statement["contraparte_id"] == customer["id"]
    assert statement["contraparte_type"] == "customer"
    assert statement["razon_social"] == customer["razon_social"]
    assert statement["documento"] is None
    assert statement["condicion_fiscal"] == "RI"
    assert statement["email"] == customer["email"]
    assert statement["date_from"] is None
    assert statement["date_to"] is None
    # SMTP_HOST is unset in the test environment -> fail-closed false.
    assert statement["emails_enabled"] is False

    # Totals: ventas=121 (the voided sale is excluded), notas=121 (its NC),
    # pagos=50, saldo=121 - 121 + 121 - 50 = 71 (live balance cache).
    totals = statement["totals"]
    assert totals["total_ventas"] == "121.00"
    assert totals["total_compras"] == "0.00"
    assert totals["total_notas"] == "121.00"
    assert totals["total_pagos"] == "50.00"
    assert totals["saldo_actual"] == "71.00"

    # Documents (sales + notes) with their line items.
    assert {d["kind"] for d in statement["documents"]} == {"venta", "nota"}
    sale_row = _doc_by_numero(statement, sale["numero"])
    assert sale_row["type_name"] == "Ticket"
    assert sale_row["total"] == "121.00"
    assert len(sale_row["lines"]) == 1
    line = sale_row["lines"][0]
    assert line["product_name"] == product["name"]
    assert Decimal(line["cantidad"]) == Decimal("1")
    assert line["precio_unit"] == "121.00"
    assert line["subtotal_line"] == "121.00"

    nc_row = _doc_by_numero(statement, nc["numero"])
    assert nc_row["kind"] == "nota"
    assert nc_row["type_name"] == "Nota de Crédito"
    assert nc_row["total"] == "121.00"
    assert len(nc_row["lines"]) == 1
    assert Decimal(nc_row["lines"][0]["cantidad"]) == Decimal("1")

    # Voided documents are excluded from the statement.
    assert all(d["numero"] != voided_sale["numero"] for d in statement["documents"])

    # Receipts with their payment method names.
    assert len(statement["receipts"]) == 1
    receipt_row = statement["receipts"][0]
    assert receipt_row["numero"] == receipt["document"]["numero"]
    assert receipt_row["total"] == "50.00"
    assert receipt_row["payment_method_names"] == ["Efectivo"]


def test_customer_statement_date_filtering(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    product = _create_product(client, superuser_token_headers)
    customer = _create_customer(client, superuser_token_headers)
    sale_past = _create_sale(
        client,
        superuser_token_headers,
        product["id"],
        customer["id"],
        fecha="2020-06-15T12:00:00Z",
    )
    sale_recent = _create_sale(
        client,
        superuser_token_headers,
        product["id"],
        customer["id"],
        fecha="2030-06-15T12:00:00Z",
    )
    _create_receipt(
        client,
        superuser_token_headers,
        "customer",
        customer["id"],
        _cash_method_id(db),
        "30.00",
        fecha="2025-06-15T12:00:00Z",
    )

    # Full history: both sales and the receipt.
    full = _get_statement(
        client, superuser_token_headers, "customer", customer["id"]
    )
    assert {d["numero"] for d in full["documents"]} == {
        sale_past["numero"],
        sale_recent["numero"],
    }
    assert len(full["receipts"]) == 1
    assert full["totals"]["total_ventas"] == "242.00"
    assert full["totals"]["total_pagos"] == "30.00"

    # Period covering only the receipt (2025): no documents, saldo stays live.
    mid = _get_statement(
        client,
        superuser_token_headers,
        "customer",
        customer["id"],
        date_from="2021-01-01",
        date_to="2029-12-31",
    )
    assert mid["date_from"] == "2021-01-01"
    assert mid["date_to"] == "2029-12-31"
    assert mid["documents"] == []
    assert len(mid["receipts"]) == 1
    assert mid["totals"]["total_ventas"] == "0.00"
    assert mid["totals"]["total_pagos"] == "30.00"
    assert mid["totals"]["saldo_actual"] == "212.00"

    # Open-ended bounds.
    recent_only = _get_statement(
        client,
        superuser_token_headers,
        "customer",
        customer["id"],
        date_from="2030-01-01",
    )
    assert [d["numero"] for d in recent_only["documents"]] == [sale_recent["numero"]]
    assert recent_only["receipts"] == []
    assert recent_only["totals"]["total_ventas"] == "121.00"

    past_only = _get_statement(
        client,
        superuser_token_headers,
        "customer",
        customer["id"],
        date_to="2021-12-31",
    )
    assert [d["numero"] for d in past_only["documents"]] == [sale_past["numero"]]
    assert past_only["totals"]["total_ventas"] == "121.00"


def test_supplier_statement_minimal(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    product = _create_product(client, superuser_token_headers)
    supplier = _create_supplier(client, superuser_token_headers, email=random_email())
    purchase = _create_purchase(
        client, superuser_token_headers, product["id"], supplier["id"]
    )  # 2 x 100.00 = 200.00
    _create_receipt(
        client,
        superuser_token_headers,
        "supplier",
        supplier["id"],
        _cash_method_id(db),
        "50.00",
    )

    statement = _get_statement(
        client, superuser_token_headers, "supplier", supplier["id"]
    )

    assert statement["contraparte_type"] == "supplier"
    assert statement["razon_social"] == supplier["razon_social"]
    totals = statement["totals"]
    assert totals["total_compras"] == "200.00"
    assert totals["total_ventas"] == "0.00"
    assert totals["total_notas"] == "0.00"
    assert totals["total_pagos"] == "50.00"
    assert totals["saldo_actual"] == "150.00"

    assert len(statement["documents"]) == 1
    purchase_row = statement["documents"][0]
    assert purchase_row["kind"] == "compra"
    assert purchase_row["numero"] == purchase["numero"]
    assert purchase_row["type_name"] == "Orden de Compra"
    assert purchase_row["total"] == "200.00"
    assert len(purchase_row["lines"]) == 1
    assert Decimal(purchase_row["lines"][0]["cantidad"]) == Decimal("2")
    assert purchase_row["lines"][0]["precio_unit"] == "100.00"

    assert len(statement["receipts"]) == 1
    assert statement["receipts"][0]["payment_method_names"] == ["Efectivo"]


def test_statement_not_found(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    smtp_on,  # noqa: ARG001
) -> None:
    missing = uuid.uuid4()
    for counterpart_type in ("customer", "supplier"):
        r = client.get(
            f"{settings.API_V1_STR}/{counterpart_type}s/{missing}/statement",
            headers=superuser_token_headers,
        )
        assert r.status_code == 404, r.text
        assert r.json()["detail"]["code"] == "counterpart_not_found"
        r = client.post(
            f"{settings.API_V1_STR}/{counterpart_type}s/{missing}/statement/email",
            headers=superuser_token_headers,
            json={},
        )
        assert r.status_code == 404, r.text
        assert r.json()["detail"]["code"] == "counterpart_not_found"


def test_statement_permission_gating(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
    smtp_on,  # noqa: ARG001
) -> None:
    """Customer statement needs ``customer.read``; supplier needs ``supplier.read``."""
    r = client.get(
        f"{settings.API_V1_STR}/permissions/",
        headers=superuser_token_headers,
        params={"limit": 1000},
    )
    assert r.status_code == 200
    perms = {p["code"]: p["id"] for p in r.json()["data"]}

    def _login_with_perms(permission_ids: list[str]) -> dict[str, str]:
        r = client.post(
            f"{settings.API_V1_STR}/roles/",
            headers=superuser_token_headers,
            json={
                "name": random_lower_string()[:12],
                "permission_ids": permission_ids,
            },
        )
        assert r.status_code == 200, r.text
        password = random_lower_string()
        user = crud.create_user(
            session=db,
            user_create=UserCreate(
                email=random_email(),
                password=password,
                full_name="Statement Perm User",
                role_ids=[uuid.UUID(r.json()["id"])],
            ),
        )
        r = client.post(
            f"{settings.API_V1_STR}/login/access-token",
            data={"username": user.email, "password": password},
        )
        assert r.status_code == 200, r.text
        return {"Authorization": f"Bearer {r.json()['access_token']}"}

    customer = _create_customer(client, superuser_token_headers, email=random_email())
    supplier = _create_supplier(client, superuser_token_headers, email=random_email())

    # A user with only customer.read can read and email the customer statement
    # but gets 403 on every supplier statement endpoint.
    headers = _login_with_perms([perms["customer.read"]])
    r = client.get(
        f"{settings.API_V1_STR}/customers/{customer['id']}/statement", headers=headers
    )
    assert r.status_code == 200, r.text
    r = client.post(
        f"{settings.API_V1_STR}/customers/{customer['id']}/statement/email",
        headers=headers,
        json={},
    )
    assert r.status_code == 204, r.text
    r = client.get(
        f"{settings.API_V1_STR}/suppliers/{supplier['id']}/statement", headers=headers
    )
    assert r.status_code == 403
    r = client.post(
        f"{settings.API_V1_STR}/suppliers/{supplier['id']}/statement/email",
        headers=headers,
        json={},
    )
    assert r.status_code == 403

    # A user with no permissions gets 403 on the customer endpoints too.
    no_perms_headers = _login_with_perms([])
    r = client.get(
        f"{settings.API_V1_STR}/customers/{customer['id']}/statement",
        headers=no_perms_headers,
    )
    assert r.status_code == 403


class _SendRecorder:
    """Captures send_email calls instead of talking to an SMTP server."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def __call__(self, *, email_to: str, subject: str, html_content: str) -> None:
        self.calls.append(
            {"email_to": email_to, "subject": subject, "html": html_content}
        )


@pytest.fixture()
def smtp_on(monkeypatch: pytest.MonkeyPatch):
    """Enable emails (settings.emails_enabled derives from SMTP_HOST)."""
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.test.invalid")
    return monkeypatch


def test_statement_email_disabled_rejected(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    # SMTP_HOST stays unset in the test environment -> emails disabled
    assert not settings.emails_enabled
    customer = _create_customer(client, superuser_token_headers, email=random_email())
    r = client.post(
        f"{settings.API_V1_STR}/customers/{customer['id']}/statement/email",
        headers=superuser_token_headers,
        json={},
    )
    assert r.status_code == 400, r.text
    assert r.json()["detail"]["code"] == "email_not_enabled"

    supplier = _create_supplier(client, superuser_token_headers, email=random_email())
    r = client.post(
        f"{settings.API_V1_STR}/suppliers/{supplier['id']}/statement/email",
        headers=superuser_token_headers,
        json={},
    )
    assert r.status_code == 400, r.text
    assert r.json()["detail"]["code"] == "email_not_enabled"


def test_statement_email_missing_address_rejected(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    smtp_on,  # noqa: ARG001
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    r = client.post(
        f"{settings.API_V1_STR}/customers/{customer['id']}/statement/email",
        headers=superuser_token_headers,
        json={},
    )
    assert r.status_code == 400, r.text
    assert r.json()["detail"]["code"] == "statement_email_missing_address"

    supplier = _create_supplier(client, superuser_token_headers)
    r = client.post(
        f"{settings.API_V1_STR}/suppliers/{supplier['id']}/statement/email",
        headers=superuser_token_headers,
        json={},
    )
    assert r.status_code == 400, r.text
    assert r.json()["detail"]["code"] == "statement_email_missing_address"


def test_statement_email_success_customer(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
    smtp_on,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recorder = _SendRecorder()
    monkeypatch.setattr("app.api.routes.customers.send_email", recorder)
    product = _create_product(client, superuser_token_headers)
    customer = _create_customer(client, superuser_token_headers, email=random_email())
    sale = _create_sale(
        client, superuser_token_headers, product["id"], customer["id"]
    )  # 121.00
    _create_receipt(
        client,
        superuser_token_headers,
        "customer",
        customer["id"],
        _cash_method_id(db),
        "50.00",
    )

    # With SMTP on, the statement response flags email visibility.
    statement = _get_statement(
        client, superuser_token_headers, "customer", customer["id"]
    )
    assert statement["emails_enabled"] is True

    r = client.post(
        f"{settings.API_V1_STR}/customers/{customer['id']}/statement/email",
        headers=superuser_token_headers,
        json={},
    )
    assert r.status_code == 204, r.text
    assert len(recorder.calls) == 1
    call = recorder.calls[0]
    assert call["email_to"] == customer["email"]
    assert customer["razon_social"] in call["subject"]
    # The rendered statement carries the counterpart, document, line and
    # balance data.
    assert customer["razon_social"] in call["html"]
    assert sale["numero"] in call["html"]
    assert product["name"] in call["html"]
    assert "71.00" in call["html"]  # saldo_actual: 121 - 50
    assert "2025" not in call["html"]  # no fabricated period

    # An explicit address overrides the counterpart's own email.
    override = random_email()
    r = client.post(
        f"{settings.API_V1_STR}/customers/{customer['id']}/statement/email",
        headers=superuser_token_headers,
        json={"email_to": override},
    )
    assert r.status_code == 204, r.text
    assert recorder.calls[1]["email_to"] == override


def test_statement_email_success_supplier(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
    smtp_on,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recorder = _SendRecorder()
    monkeypatch.setattr("app.api.routes.suppliers.send_email", recorder)
    product = _create_product(client, superuser_token_headers)
    supplier = _create_supplier(client, superuser_token_headers, email=random_email())
    purchase = _create_purchase(
        client, superuser_token_headers, product["id"], supplier["id"]
    )
    _create_receipt(
        client,
        superuser_token_headers,
        "supplier",
        supplier["id"],
        _cash_method_id(db),
        "50.00",
    )

    r = client.post(
        f"{settings.API_V1_STR}/suppliers/{supplier['id']}/statement/email",
        headers=superuser_token_headers,
        json={},
    )
    assert r.status_code == 204, r.text
    assert len(recorder.calls) == 1
    call = recorder.calls[0]
    assert call["email_to"] == supplier["email"]
    assert supplier["razon_social"] in call["html"]
    assert purchase["numero"] in call["html"]
    assert "150.00" in call["html"]  # saldo_actual: 200 - 50


def test_statement_email_smtp_failure_maps_to_business_error(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
    smtp_on,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _raise(*, email_to: str, subject: str, html_content: str) -> None:  # noqa: ARG001
        raise RuntimeError("smtp down")

    monkeypatch.setattr("app.api.routes.customers.send_email", _raise)
    product = _create_product(client, superuser_token_headers)
    customer = _create_customer(client, superuser_token_headers, email=random_email())
    _create_sale(client, superuser_token_headers, product["id"], customer["id"])

    r = client.post(
        f"{settings.API_V1_STR}/customers/{customer['id']}/statement/email",
        headers=superuser_token_headers,
        json={},
    )
    assert r.status_code == 400, r.text
    assert r.json()["detail"]["code"] == "statement_email_failed"

    # The endpoint is read-only: the statement still shows the same data.
    statement = _get_statement(
        client, superuser_token_headers, "customer", customer["id"]
    )
    assert statement["totals"]["saldo_actual"] == "121.00"
    assert len(statement["documents"]) == 1
