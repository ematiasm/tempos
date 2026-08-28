"""Tests for the document-email endpoints (POST /{id}/email, GET /email-status)."""

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app import crud
from app.core.config import settings
from app.models import UserCreate
from tests.utils.ledger import load_stock
from tests.utils.utils import random_email, random_lower_string


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


def _doc_type_id(client: TestClient, headers: dict[str, str], prefix: str) -> str:
    r = client.get(
        f"{settings.API_V1_STR}/document-types/",
        headers=headers,
        params={"limit": 100},
    )
    assert r.status_code == 200
    return next(row for row in r.json()["data"] if row["prefix"] == prefix)["id"]


def _create_sale(
    client: TestClient,
    headers: dict[str, str],
    customer: dict,
    notes: str | None = None,
) -> dict:
    product = _create_product(client, headers)
    load_stock(client, headers, product["id"], "1")
    tck = _doc_type_id(client, headers, "TCK")
    payload: dict[str, Any] = {
        "document_type_id": tck,
        "contraparte_id": customer["id"],
        "lines": [{"product_id": product["id"], "cantidad": "1"}],
    }
    if notes is not None:
        payload["notes"] = notes
    r = client.post(f"{settings.API_V1_STR}/documents/", headers=headers, json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def _email_document(
    client: TestClient,
    headers: dict[str, str],
    document_id: str,
    json_body: dict[str, Any] | None = None,
):
    return client.post(
        f"{settings.API_V1_STR}/documents/{document_id}/email",
        headers=headers,
        json=json_body if json_body is not None else {},
    )


def test_email_auto_uses_counterpart_email(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    smtp_on,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recorder = _SendRecorder()
    monkeypatch.setattr("app.api.routes.documents.send_email", recorder)
    customer = _create_customer(client, superuser_token_headers, email=random_email())
    doc = _create_sale(
        client, superuser_token_headers, customer, notes="Thanks for buying"
    )

    r = _email_document(client, superuser_token_headers, doc["id"])
    assert r.status_code == 204, r.text
    assert len(recorder.calls) == 1
    call = recorder.calls[0]
    assert call["email_to"] == customer["email"]
    assert doc["numero"] in call["subject"]
    # the voucher content renders the document data (template + context)
    assert doc["numero"] in call["html"]
    assert customer["razon_social"] in call["html"]
    assert "Thanks for buying" in call["html"]


def test_email_explicit_address_overrides_counterpart(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    smtp_on,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recorder = _SendRecorder()
    monkeypatch.setattr("app.api.routes.documents.send_email", recorder)
    customer = _create_customer(client, superuser_token_headers, email=random_email())
    doc = _create_sale(client, superuser_token_headers, customer)

    override = random_email()
    r = _email_document(
        client, superuser_token_headers, doc["id"], {"email_to": override}
    )
    assert r.status_code == 204, r.text
    assert recorder.calls[0]["email_to"] == override


def test_email_missing_address_rejected(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    smtp_on,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recorder = _SendRecorder()
    monkeypatch.setattr("app.api.routes.documents.send_email", recorder)
    customer = _create_customer(client, superuser_token_headers)
    doc = _create_sale(client, superuser_token_headers, customer)

    r = _email_document(client, superuser_token_headers, doc["id"])
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "document_email_missing_address"
    assert recorder.calls == []


def test_email_disabled_rejected(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # SMTP_HOST stays unset in the test environment -> emails disabled
    assert not settings.emails_enabled
    recorder = _SendRecorder()
    monkeypatch.setattr("app.api.routes.documents.send_email", recorder)
    customer = _create_customer(client, superuser_token_headers, email=random_email())
    doc = _create_sale(client, superuser_token_headers, customer)

    r = _email_document(client, superuser_token_headers, doc["id"])
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "email_not_enabled"
    assert recorder.calls == []


def test_email_smtp_failure_maps_to_business_error(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    smtp_on,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _raise(*, email_to: str, subject: str, html_content: str) -> None:  # noqa: ARG001
        raise RuntimeError("smtp down")

    monkeypatch.setattr("app.api.routes.documents.send_email", _raise)
    customer = _create_customer(client, superuser_token_headers, email=random_email())
    doc = _create_sale(
        client, superuser_token_headers, customer, notes="untouched note"
    )

    r = _email_document(client, superuser_token_headers, doc["id"])
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "document_email_failed"

    # the document is unchanged (no DB write on the path)
    r = client.get(
        f"{settings.API_V1_STR}/documents/{doc['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["estado"] == "active"
    assert body["notes"] == "untouched note"
    assert body["numero"] == doc["numero"]


def test_email_status_reports_emails_enabled(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    smtp_on,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    r = client.get(
        f"{settings.API_V1_STR}/documents/email-status",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"emails_enabled": True}

    # SMTP off -> fail-closed false
    monkeypatch.setattr(settings, "SMTP_HOST", None)
    r = client.get(
        f"{settings.API_V1_STR}/documents/email-status",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"emails_enabled": False}


def test_email_requires_document_email_permission(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
    smtp_on,  # noqa: ARG001
) -> None:
    """A role without document.email gets 403 on both endpoints."""
    r = client.post(
        f"{settings.API_V1_STR}/roles/",
        headers=superuser_token_headers,
        json={"name": random_lower_string()[:12], "permission_ids": []},
    )
    assert r.status_code == 200, r.text
    restricted_role_id = r.json()["id"]
    password = random_lower_string()
    user = crud.create_user(
        session=db,
        user_create=UserCreate(
            email=random_email(),
            password=password,
            full_name="No Email Perm",
            role_ids=[uuid.UUID(restricted_role_id)],
        ),
    )
    r = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={"username": user.email, "password": password},
    )
    assert r.status_code == 200, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    customer = _create_customer(client, superuser_token_headers, email=random_email())
    doc = _create_sale(client, superuser_token_headers, customer)

    r = _email_document(client, headers, doc["id"])
    assert r.status_code == 403
    r = client.get(f"{settings.API_V1_STR}/documents/email-status", headers=headers)
    assert r.status_code == 403
