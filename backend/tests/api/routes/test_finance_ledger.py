"""Tests for the finance ledger: AccountMovement, current-account ledgers."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.models import PaymentMethod
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


def _cash_account_id(client: TestClient, headers: dict[str, str]) -> str:
    r = client.get(
        f"{settings.API_V1_STR}/financial-accounts/",
        headers=headers,
        params={"limit": 100},
    )
    assert r.status_code == 200, r.text
    return next(a["id"] for a in r.json()["data"] if a["name"] == "Caja Principal")


def _account_saldo(
    client: TestClient, headers: dict[str, str], account_id: str
) -> Decimal:
    r = client.get(
        f"{settings.API_V1_STR}/financial-accounts/{account_id}", headers=headers
    )
    assert r.status_code == 200, r.text
    return Decimal(r.json()["saldo"])


def _customer_saldo(
    client: TestClient, headers: dict[str, str], customer_id: str
) -> Decimal:
    r = client.get(f"{settings.API_V1_STR}/customers/{customer_id}", headers=headers)
    assert r.status_code == 200, r.text
    return Decimal(r.json()["saldo"])


def _supplier_saldo(
    client: TestClient, headers: dict[str, str], supplier_id: str
) -> Decimal:
    r = client.get(f"{settings.API_V1_STR}/suppliers/{supplier_id}", headers=headers)
    assert r.status_code == 200, r.text
    return Decimal(r.json()["saldo"])


def _account_movements(client: TestClient, headers: dict[str, str], **params) -> list:
    r = client.get(
        f"{settings.API_V1_STR}/account-movements/",
        headers=headers,
        params=params,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _customer_movements(
    client: TestClient, headers: dict[str, str], customer_id: str, **params
) -> list:
    r = client.get(
        f"{settings.API_V1_STR}/customers/{customer_id}/account-movements",
        headers=headers,
        params=params,
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_cash_sale_moves_main_cash_account(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "1")
    customer = _create_customer(client, superuser_token_headers)
    tck = _doc_type_id(client, superuser_token_headers, "TCK")
    account_id = _cash_account_id(client, superuser_token_headers)
    before = _account_saldo(client, superuser_token_headers, account_id)

    doc = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],  # 121.00
            "payments": [{"payment_method_id": _cash_method_id(db), "monto": "121.00"}],
        },
    )
    assert doc["total"] == "121.00"
    assert _account_saldo(
        client, superuser_token_headers, account_id
    ) == before + Decimal("121.00")
    # fully paid → no current-account movement
    assert _customer_saldo(client, superuser_token_headers, customer["id"]) == Decimal(
        "0"
    )
    assert (
        _customer_movements(client, superuser_token_headers, customer["id"])["count"]
        == 0
    )

    # the account movement is recorded with cobro tipo + document link
    page = _account_movements(client, superuser_token_headers, limit=100)
    mov = next(m for m in page["data"] if m["document_id"] == doc["id"])
    assert mov["tipo"] == "cobro"
    assert mov["monto"] == "121.00"
    assert mov["account_name"] == "Caja Principal"
    assert mov["document_numero"] == doc["numero"]


def test_partial_payment_leaves_balance_and_moves_cash(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "1")
    customer = _create_customer(client, superuser_token_headers)
    tck = _doc_type_id(client, superuser_token_headers, "TCK")
    account_id = _cash_account_id(client, superuser_token_headers)
    before = _account_saldo(client, superuser_token_headers, account_id)

    doc = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],  # 121.00
            "payments": [{"payment_method_id": _cash_method_id(db), "monto": "21.00"}],
        },
    )
    assert _account_saldo(
        client, superuser_token_headers, account_id
    ) == before + Decimal("21.00")
    assert _customer_saldo(client, superuser_token_headers, customer["id"]) == Decimal(
        "100.00"
    )

    page = _customer_movements(
        client, superuser_token_headers, customer["id"], limit=100
    )
    assert page["count"] == 1
    mov = page["data"][0]
    assert mov["monto"] == "100.00"
    assert mov["document_id"] == doc["id"]
    assert mov["document_numero"] == doc["numero"]


def test_overpayment_creates_credit_in_favor(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "1")
    customer = _create_customer(client, superuser_token_headers)
    tck = _doc_type_id(client, superuser_token_headers, "TCK")
    account_id = _cash_account_id(client, superuser_token_headers)
    before = _account_saldo(client, superuser_token_headers, account_id)

    _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],  # 121.00
            "payments": [{"payment_method_id": _cash_method_id(db), "monto": "200.00"}],
        },
    )
    assert _account_saldo(
        client, superuser_token_headers, account_id
    ) == before + Decimal("200.00")
    # customer ends with credit in favor
    assert _customer_saldo(client, superuser_token_headers, customer["id"]) == Decimal(
        "-79.00"
    )


def test_card_commission_and_deferred_accreditation(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "1")
    customer = _create_customer(client, superuser_token_headers)
    tck = _doc_type_id(client, superuser_token_headers, "TCK")

    r = client.post(
        f"{settings.API_V1_STR}/financial-accounts/",
        headers=superuser_token_headers,
        json={"name": "Banco Test"},
    )
    assert r.status_code == 200, r.text
    bank_account = r.json()
    r = client.post(
        f"{settings.API_V1_STR}/payment-methods/",
        headers=superuser_token_headers,
        json={
            "name": "Tarjeta Test",
            "financial_account_id": bank_account["id"],
            "requiere_conciliacion": True,
        },
    )
    assert r.status_code == 200, r.text
    card_method = r.json()

    accreditation = (datetime.now(UTC) + timedelta(days=3)).isoformat()
    doc = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],  # 121.00
            "payments": [
                {
                    "payment_method_id": card_method["id"],
                    "monto": "121.00",
                    "comision_pct": "3.00",
                    "fecha_acreditacion": accreditation,
                }
            ],
        },
    )

    # bank account: cobro +121.00 and comision -3.63 in the same account
    assert _account_saldo(
        client, superuser_token_headers, bank_account["id"]
    ) == Decimal("117.37")
    page = _account_movements(client, superuser_token_headers, limit=100)
    movements = [m for m in page["data"] if m["document_id"] == doc["id"]]
    assert len(movements) == 2
    cobro = next(m for m in movements if m["tipo"] == "cobro")
    comision = next(m for m in movements if m["tipo"] == "comision")
    assert cobro["monto"] == "121.00"
    assert cobro["fecha_acreditacion"] is not None
    assert comision["monto"] == "-3.63"
    assert comision["fecha_acreditacion"] is not None
    assert comision["payment_method_id"] == card_method["id"]

    # card payment conciliation flag starts false
    assert cobro["conciliado"] is False


def _create_current_account_method(client: TestClient, headers: dict[str, str]) -> dict:
    """Create a credit/current-account method (marks_paid=False) on a fresh
    account that carries no movements."""
    r = client.post(
        f"{settings.API_V1_STR}/financial-accounts/",
        headers=headers,
        json={"name": "CTA Cliente Test"},
    )
    assert r.status_code == 200, r.text
    client_account = r.json()
    r = client.post(
        f"{settings.API_V1_STR}/payment-methods/",
        headers=headers,
        json={
            "name": "Cuenta Test",
            "financial_account_id": client_account["id"],
            "marks_paid": False,
        },
    )
    assert r.status_code == 200, r.text
    return {"method": r.json(), "account": client_account}


def test_current_account_payment_does_not_mark_sale_as_paid(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "1")
    customer = _create_customer(client, superuser_token_headers)
    tck = _doc_type_id(client, superuser_token_headers, "TCK")

    current = _create_current_account_method(client, superuser_token_headers)
    current_method = current["method"]

    # a payment via the current-account method neither moves the financial
    # account nor counts as paid: the full total stays on the customer balance
    doc = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],  # 121.00
            "payments": [
                {
                    "payment_method_id": current_method["id"],
                    "monto": "121.00",
                }
            ],
        },
    )
    assert _account_saldo(
        client, superuser_token_headers, current["account"]["id"]
    ) == Decimal("0")
    assert _customer_saldo(client, superuser_token_headers, customer["id"]) == Decimal(
        "121.00"
    )
    page = _account_movements(client, superuser_token_headers, limit=100)
    assert not any(
        m["financial_account_id"] == current["account"]["id"] for m in page["data"]
    )
    # the payment itself is still documented on the voucher
    assert len(doc["payments"]) == 1
    assert doc["payments"][0]["payment_method_id"] == current_method["id"]


def test_current_account_payment_combined_with_cash(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "1")
    customer = _create_customer(client, superuser_token_headers)
    tck = _doc_type_id(client, superuser_token_headers, "TCK")
    account_id = _cash_account_id(client, superuser_token_headers)
    before = _account_saldo(client, superuser_token_headers, account_id)

    current = _create_current_account_method(client, superuser_token_headers)

    # 21 cash + 100 on the current account: only the cash moves, the balance
    # delta covers the credit portion
    _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],  # 121.00
            "payments": [
                {"payment_method_id": _cash_method_id(db), "monto": "21.00"},
                {
                    "payment_method_id": current["method"]["id"],
                    "monto": "100.00",
                },
            ],
        },
    )
    assert _account_saldo(
        client, superuser_token_headers, account_id
    ) == before + Decimal("21.00")
    assert _customer_saldo(client, superuser_token_headers, customer["id"]) == Decimal(
        "100.00"
    )


def _outstanding(
    client: TestClient, headers: dict[str, str], customer_id: str
) -> list:
    r = client.get(
        f"{settings.API_V1_STR}/payments/outstanding",
        headers=headers,
        params={"contraparte_type": "customer", "contraparte_id": customer_id},
    )
    assert r.status_code == 200, r.text
    return r.json()["data"]


def test_favor_monto_nets_pending_without_moving_cash(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "2")
    customer = _create_customer(client, superuser_token_headers)
    tck = _doc_type_id(client, superuser_token_headers, "TCK")
    account_id = _cash_account_id(client, superuser_token_headers)
    before = _account_saldo(client, superuser_token_headers, account_id)

    # first sale overpays: the customer ends with 79.00 credit in favor
    _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],  # 121.00
            "payments": [{"payment_method_id": _cash_method_id(db), "monto": "200.00"}],
        },
    )
    assert _customer_saldo(client, superuser_token_headers, customer["id"]) == Decimal(
        "-79.00"
    )

    # second sale pays 42.00 cash; the remaining 79.00 is covered by the
    # credit in favor automatically (favor_monto)
    doc = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],  # 121.00
            "payments": [{"payment_method_id": _cash_method_id(db), "monto": "42.00"}],
        },
    )
    assert doc["favor_monto"] == "79.00"
    assert len(doc["payments"]) == 1
    # only the cash amount moves the financial account
    assert _account_saldo(
        client, superuser_token_headers, account_id
    ) == before + Decimal("242.00")
    # the favor nets the balance back to zero
    assert _customer_saldo(client, superuser_token_headers, customer["id"]) == Decimal(
        "0"
    )
    # nothing remains outstanding
    assert _outstanding(client, superuser_token_headers, customer["id"]) == []


def test_favor_monto_on_credit_sale_leaves_remainder_outstanding(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "2")
    customer = _create_customer(client, superuser_token_headers)
    tck = _doc_type_id(client, superuser_token_headers, "TCK")
    current = _create_current_account_method(client, superuser_token_headers)

    _create_doc(  # overpay: 79.00 credit in favor
        client,
        superuser_token_headers,
        {
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],
            "payments": [{"payment_method_id": _cash_method_id(db), "monto": "200.00"}],
        },
    )
    # full 121.00 charged to the current account: 79.00 net with the favor and
    # only the 42.00 remainder stays outstanding
    doc = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],  # 121.00
            "payments": [
                {"payment_method_id": current["method"]["id"], "monto": "121.00"},
            ],
        },
    )
    assert doc["favor_monto"] == "79.00"
    assert len(doc["payments"]) == 1
    # -79.00 favor + full 121.00 on the current account = 42.00 owed
    assert _customer_saldo(client, superuser_token_headers, customer["id"]) == Decimal(
        "42.00"
    )
    rows = _outstanding(client, superuser_token_headers, customer["id"])
    assert len(rows) == 1
    assert rows[0]["document_id"] == doc["id"]
    assert rows[0]["pendiente"] == "42.00"


def test_favor_monto_fully_covers_small_sale(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "2")
    customer = _create_customer(client, superuser_token_headers)
    tck = _doc_type_id(client, superuser_token_headers, "TCK")

    _create_doc(  # overpay: 79.00 credit in favor
        client,
        superuser_token_headers,
        {
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],
            "payments": [{"payment_method_id": _cash_method_id(db), "monto": "200.00"}],
        },
    )
    # a 60.00 unpaid sale is fully covered by the favor
    doc = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "lines": [
                {
                    "product_id": product["id"],
                    "cantidad": "1",
                    "precio_unit": "60.00",
                }
            ],
            "payments": [],
        },
    )
    assert doc["favor_monto"] == "60.00"
    assert _customer_saldo(client, superuser_token_headers, customer["id"]) == Decimal(
        "-19.00"
    )
    assert _outstanding(client, superuser_token_headers, customer["id"]) == []


def test_favor_monto_not_used_when_fully_paid_in_cash(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "2")
    customer = _create_customer(client, superuser_token_headers)
    tck = _doc_type_id(client, superuser_token_headers, "TCK")

    _create_doc(  # overpay: 79.00 credit in favor
        client,
        superuser_token_headers,
        {
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],
            "payments": [{"payment_method_id": _cash_method_id(db), "monto": "200.00"}],
        },
    )
    # paying the full total in cash leaves the credit in favor untouched
    doc = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],  # 121.00
            "payments": [{"payment_method_id": _cash_method_id(db), "monto": "121.00"}],
        },
    )
    assert doc["favor_monto"] == "0.00"
    assert _customer_saldo(client, superuser_token_headers, customer["id"]) == Decimal(
        "-79.00"
    )
    assert _outstanding(client, superuser_token_headers, customer["id"]) == []


def test_void_sale_with_favor_restores_credit_in_favor(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "2")
    customer = _create_customer(client, superuser_token_headers)
    tck = _doc_type_id(client, superuser_token_headers, "TCK")

    _create_doc(  # overpay: 79.00 credit in favor
        client,
        superuser_token_headers,
        {
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],
            "payments": [{"payment_method_id": _cash_method_id(db), "monto": "200.00"}],
        },
    )
    doc = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],  # 121.00
            "payments": [{"payment_method_id": _cash_method_id(db), "monto": "42.00"}],
        },
    )
    assert doc["favor_monto"] == "79.00"
    assert _customer_saldo(client, superuser_token_headers, customer["id"]) == Decimal(
        "0"
    )

    r = client.post(
        f"{settings.API_V1_STR}/documents/{doc['id']}/void",
        headers=superuser_token_headers,
        json={"lines": [], "payments": []},
    )
    assert r.status_code == 200, r.text
    nc = r.json()
    # the NC mirrors the cash payment; the favor is not a payment row
    assert len(nc["payments"]) == 1
    assert nc["payments"][0]["monto"] == "42.00"
    assert nc["payments"][0]["payment_method_id"] == _cash_method_id(db)
    # voiding reverses the favor consumption
    assert _customer_saldo(client, superuser_token_headers, customer["id"]) == Decimal(
        "-79.00"
    )
    assert nc["favor_monto"] == "0.00"


def test_void_credit_sale_reverses_customer_balance(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "1")
    customer = _create_customer(client, superuser_token_headers)
    tck = _doc_type_id(client, superuser_token_headers, "TCK")

    current = _create_current_account_method(client, superuser_token_headers)
    doc = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],  # 121.00
            "payments": [
                {
                    "payment_method_id": current["method"]["id"],
                    "monto": "121.00",
                }
            ],
        },
    )
    assert _customer_saldo(client, superuser_token_headers, customer["id"]) == Decimal(
        "121.00"
    )

    r = client.post(
        f"{settings.API_V1_STR}/documents/{doc['id']}/void",
        headers=superuser_token_headers,
        json={"lines": [], "payments": []},
    )
    assert r.status_code == 200, r.text
    assert _customer_saldo(client, superuser_token_headers, customer["id"]) == Decimal(
        "0"
    )
    page = _customer_movements(
        client, superuser_token_headers, customer["id"], limit=100
    )
    assert [Decimal(m["monto"]) for m in page["data"]] == [
        Decimal("-121.00"),
        Decimal("121.00"),
    ]
    # the credit account never moved
    assert _account_saldo(
        client, superuser_token_headers, current["account"]["id"]
    ) == Decimal("0")


def test_purchase_partial_payment_and_nc_reversal(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    product = _create_product(client, superuser_token_headers)
    supplier = _create_supplier(client, superuser_token_headers)
    oc = _doc_type_id(client, superuser_token_headers, "OC")
    account_id = _cash_account_id(client, superuser_token_headers)
    before = _account_saldo(client, superuser_token_headers, account_id)

    doc = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": oc,
            "contraparte_id": supplier["id"],
            "lines": [{"product_id": product["id"], "cantidad": "2"}],  # 200.00
            "payments": [{"payment_method_id": _cash_method_id(db), "monto": "50.00"}],
        },
    )
    assert doc["total"] == "200.00"
    assert _account_saldo(
        client, superuser_token_headers, account_id
    ) == before - Decimal("50.00")
    # we owe the supplier the unpaid remainder
    assert _supplier_saldo(client, superuser_token_headers, supplier["id"]) == Decimal(
        "150.00"
    )
    page = _account_movements(client, superuser_token_headers, limit=100)
    mov = next(m for m in page["data"] if m["document_id"] == doc["id"])
    assert mov["tipo"] == "pago"
    assert mov["monto"] == "-50.00"

    # void the purchase: the NC Compra reverses both the balance and the stock
    r = client.post(
        f"{settings.API_V1_STR}/documents/{doc['id']}/void",
        headers=superuser_token_headers,
        json={"lines": [], "payments": []},
    )
    assert r.status_code == 200, r.text
    assert _supplier_saldo(client, superuser_token_headers, supplier["id"]) == Decimal(
        "0"
    )


def test_void_unpaid_sale_reverses_customer_balance(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "2")
    customer = _create_customer(client, superuser_token_headers)
    tck = _doc_type_id(client, superuser_token_headers, "TCK")
    doc = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],  # 121.00
        },
    )
    assert _customer_saldo(client, superuser_token_headers, customer["id"]) == Decimal(
        "121.00"
    )

    r = client.post(
        f"{settings.API_V1_STR}/documents/{doc['id']}/void",
        headers=superuser_token_headers,
        json={"lines": [], "payments": []},
    )
    assert r.status_code == 200, r.text
    assert _customer_saldo(client, superuser_token_headers, customer["id"]) == Decimal(
        "0"
    )
    page = _customer_movements(
        client, superuser_token_headers, customer["id"], limit=100
    )
    assert page["count"] == 2
    assert [Decimal(m["monto"]) for m in page["data"]] == [
        Decimal("-121.00"),
        Decimal("121.00"),
    ]
