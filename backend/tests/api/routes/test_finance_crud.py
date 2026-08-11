"""Tests for finance CRUD: accounts, payment methods, transfers, conciliation."""

from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.models import FinancialAccount, PaymentMethod
from tests.utils.ledger import load_stock
from tests.utils.utils import random_lower_string


def test_seeded_credit_method_and_account(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    method = db.exec(
        select(PaymentMethod).where(PaymentMethod.name == "Crédito")
    ).first()
    assert method is not None, "Seeded credit payment method not found"
    assert method.marks_paid is False
    account = db.exec(
        select(FinancialAccount).where(FinancialAccount.name == "Crédito")
    ).first()
    assert account is not None, "Seeded credit financial account not found"
    assert method.financial_account_id == account.id


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
    assert r.status_code == 200
    return next(row for row in r.json()["data"] if row["prefix"] == prefix)["id"]


def _create_account(client: TestClient, headers: dict[str, str], name: str) -> dict:
    r = client.post(
        f"{settings.API_V1_STR}/financial-accounts/",
        headers=headers,
        json={"name": name},
    )
    assert r.status_code == 200, r.text
    return r.json()


def _create_payment_method(
    client: TestClient, headers: dict[str, str], name: str, account_id: str
) -> dict:
    r = client.post(
        f"{settings.API_V1_STR}/payment-methods/",
        headers=headers,
        json={"name": name, "financial_account_id": account_id},
    )
    assert r.status_code == 200, r.text
    return r.json()


def _cash_method_id(db: Session) -> str:
    method = db.exec(
        select(PaymentMethod).where(PaymentMethod.name == "Efectivo")
    ).first()
    assert method is not None, "Seeded cash payment method not found"
    return str(method.id)


def test_financial_account_crud_flow(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    name = f"Cuenta {random_lower_string()[:6]}"
    account = _create_account(client, superuser_token_headers, name)
    assert account["saldo"] == "0.00"
    assert account["currency"] == "ARS"

    # appears in the list
    r = client.get(
        f"{settings.API_V1_STR}/financial-accounts/",
        headers=superuser_token_headers,
        params={"limit": 100},
    )
    assert r.status_code == 200, r.text
    assert any(a["id"] == account["id"] for a in r.json()["data"])

    # single fetch
    r = client.get(
        f"{settings.API_V1_STR}/financial-accounts/{account['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["name"] == name

    # update name
    updated_name = f"Cuenta {random_lower_string()[:6]}"
    r = client.patch(
        f"{settings.API_V1_STR}/financial-accounts/{account['id']}",
        headers=superuser_token_headers,
        json={"name": updated_name},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == updated_name
    assert body["saldo"] == "0.00"

    # unused account can be deleted
    r = client.delete(
        f"{settings.API_V1_STR}/financial-accounts/{account['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200, r.text
    r = client.get(
        f"{settings.API_V1_STR}/financial-accounts/{account['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 404


def test_delete_account_in_use_rejected(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    # account referenced by a payment method cannot be deleted
    account = _create_account(client, superuser_token_headers, "Caja Secundaria")
    _create_payment_method(client, superuser_token_headers, "Secundario", account["id"])
    r = client.delete(
        f"{settings.API_V1_STR}/financial-accounts/{account['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 400
    assert "payment methods" in r.json()["detail"]

    # account with ledger movements cannot be deleted
    other = _create_account(client, superuser_token_headers, "Cuenta Bloqueada")
    r = client.post(
        f"{settings.API_V1_STR}/transfers/",
        headers=superuser_token_headers,
        json={
            "from_account_id": other["id"],
            "to_account_id": account["id"],
            "monto": "10.00",
        },
    )
    assert r.status_code == 200, r.text
    r = client.delete(
        f"{settings.API_V1_STR}/financial-accounts/{other['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 400
    assert "ledger movements" in r.json()["detail"]


def test_payment_method_crud_and_delete_protection(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    account = _create_account(client, superuser_token_headers, "CTA Banco")
    method = _create_payment_method(
        client, superuser_token_headers, "Visa CRUD", account["id"]
    )
    assert method["requiere_conciliacion"] is False
    assert method["marks_paid"] is True

    # update
    r = client.patch(
        f"{settings.API_V1_STR}/payment-methods/{method['id']}",
        headers=superuser_token_headers,
        json={"name": "Visa CRUD 2", "requiere_conciliacion": True},
    )
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Visa CRUD 2"
    assert r.json()["requiere_conciliacion"] is True
    assert r.json()["marks_paid"] is True

    # a current-account method can be created and toggled
    r = client.post(
        f"{settings.API_V1_STR}/payment-methods/",
        headers=superuser_token_headers,
        json={
            "name": "Credito CRUD",
            "financial_account_id": account["id"],
            "marks_paid": False,
        },
    )
    assert r.status_code == 200, r.text
    credit_method = r.json()
    assert credit_method["marks_paid"] is False

    # list contains it
    r = client.get(
        f"{settings.API_V1_STR}/payment-methods/",
        headers=superuser_token_headers,
        params={"limit": 100},
    )
    assert r.status_code == 200, r.text
    assert any(m["id"] == method["id"] for m in r.json()["data"])

    # unused method can be deleted
    r = client.delete(
        f"{settings.API_V1_STR}/payment-methods/{method['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200, r.text

    # a method used by a document cannot be deleted
    used = _create_payment_method(
        client, superuser_token_headers, "Visa Usada", account["id"]
    )
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "1")
    customer = _create_customer(client, superuser_token_headers)
    tck = _doc_type_id(client, superuser_token_headers, "TCK")
    r = client.post(
        f"{settings.API_V1_STR}/documents/",
        headers=superuser_token_headers,
        json={
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],
            "payments": [{"payment_method_id": used["id"], "monto": "121.00"}],
        },
    )
    assert r.status_code == 200, r.text
    r = client.delete(
        f"{settings.API_V1_STR}/payment-methods/{used['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 400
    assert "documents" in r.json()["detail"]


def test_transfer_moves_both_accounts_atomically(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    a = _create_account(client, superuser_token_headers, "Cuenta A")
    b = _create_account(client, superuser_token_headers, "Cuenta B")

    r = client.post(
        f"{settings.API_V1_STR}/transfers/",
        headers=superuser_token_headers,
        json={"from_account_id": a["id"], "to_account_id": b["id"], "monto": "150.00"},
    )
    assert r.status_code == 200, r.text
    transfer = r.json()
    assert transfer["monto"] == "150.00"

    def _saldo(account_id: str) -> Decimal:
        r = client.get(
            f"{settings.API_V1_STR}/financial-accounts/{account_id}",
            headers=superuser_token_headers,
        )
        assert r.status_code == 200, r.text
        return Decimal(r.json()["saldo"])

    assert _saldo(a["id"]) == Decimal("-150.00")
    assert _saldo(b["id"]) == Decimal("150.00")

    # both ledger rows are TRANSFERENCIA with transfer_id set and no document
    page = _account_movements(client, superuser_token_headers, limit=100)
    movements = [m for m in page["data"] if m["transfer_id"] == transfer["id"]]
    assert len(movements) == 2
    by_account = {m["financial_account_id"]: m for m in movements}
    assert by_account[a["id"]]["monto"] == "-150.00"
    assert by_account[b["id"]]["monto"] == "150.00"
    assert all(m["tipo"] == "transferencia" for m in movements)
    assert all(m["document_id"] is None for m in movements)

    # transfer to the same account is rejected before any write
    r = client.post(
        f"{settings.API_V1_STR}/transfers/",
        headers=superuser_token_headers,
        json={"from_account_id": a["id"], "to_account_id": a["id"], "monto": "5.00"},
    )
    assert r.status_code == 400
    assert "different accounts" in r.json()["detail"]
    assert _saldo(a["id"]) == Decimal("-150.00")


def test_conciliate_movement(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    a = _create_account(client, superuser_token_headers, "Cuenta Conciliar")
    b = _create_account(client, superuser_token_headers, "Cuenta Conciliar Dest")
    r = client.post(
        f"{settings.API_V1_STR}/transfers/",
        headers=superuser_token_headers,
        json={"from_account_id": a["id"], "to_account_id": b["id"], "monto": "50.00"},
    )
    assert r.status_code == 200, r.text
    transfer = r.json()

    page = _account_movements(client, superuser_token_headers, limit=100)
    movement = next(m for m in page["data"] if m["transfer_id"] == transfer["id"])
    assert movement["conciliado"] is False

    r = client.post(
        f"{settings.API_V1_STR}/account-movements/{movement['id']}/conciliate",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["conciliado"] is True

    # filter by conciliado flag shows it
    page = _account_movements(
        client, superuser_token_headers, conciliado=True, limit=100
    )
    assert any(m["id"] == movement["id"] for m in page["data"])
    page = _account_movements(
        client, superuser_token_headers, conciliado=False, limit=100
    )
    assert not any(m["id"] == movement["id"] for m in page["data"])

    # unknown movement → 404
    r = client.post(
        f"{settings.API_V1_STR}/account-movements/00000000-0000-0000-0000-000000000000/conciliate",
        headers=superuser_token_headers,
    )
    assert r.status_code == 404


def _account_movements(client: TestClient, headers: dict[str, str], **params) -> dict:
    r = client.get(
        f"{settings.API_V1_STR}/account-movements/",
        headers=headers,
        params=params,
    )
    assert r.status_code == 200, r.text
    return r.json()
