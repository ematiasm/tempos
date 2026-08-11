"""Tests for payment receipts (standalone payments against current account)."""

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


def _account_movements(client: TestClient, headers: dict[str, str], **params) -> list:
    r = client.get(
        f"{settings.API_V1_STR}/account-movements/",
        headers=headers,
        params=params,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _create_sale(
    client: TestClient,
    headers: dict[str, str],
    product_id: str,
    customer_id: str,
    stock: str = "1",
    payments: list[dict] | None = None,
) -> dict:
    load_stock(client, headers, product_id, stock)
    r = client.post(
        f"{settings.API_V1_STR}/documents/",
        headers=headers,
        json={
            "document_type_id": _doc_type_id(client, headers, "TCK"),
            "contraparte_id": customer_id,
            "lines": [{"product_id": product_id, "cantidad": "1"}],
            "payments": payments or [],
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def _create_purchase(
    client: TestClient,
    headers: dict[str, str],
    product_id: str,
    supplier_id: str,
    payments: list[dict] | None = None,
) -> dict:
    r = client.post(
        f"{settings.API_V1_STR}/documents/",
        headers=headers,
        json={
            "document_type_id": _doc_type_id(client, headers, "OC"),
            "contraparte_id": supplier_id,
            "lines": [{"product_id": product_id, "cantidad": "2"}],
            "payments": payments or [],
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
) -> dict:
    r = client.post(
        f"{settings.API_V1_STR}/payments/",
        headers=headers,
        json={
            "contraparte_type": contraparte_type,
            "contraparte_id": contraparte_id,
            "payments": [{"payment_method_id": method_id, "monto": monto}],
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def _outstanding(
    client: TestClient,
    headers: dict[str, str],
    contraparte_type: str,
    contraparte_id: str,
) -> dict:
    r = client.get(
        f"{settings.API_V1_STR}/payments/outstanding",
        headers=headers,
        params={
            "contraparte_type": contraparte_type,
            "contraparte_id": contraparte_id,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_receipt_pays_oldest_outstanding_first(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    product = _create_product(client, superuser_token_headers)
    customer = _create_customer(client, superuser_token_headers)
    first = _create_sale(client, superuser_token_headers, product["id"], customer["id"])
    second = _create_sale(
        client, superuser_token_headers, product["id"], customer["id"]
    )
    assert _customer_saldo(client, superuser_token_headers, customer["id"]) == Decimal(
        "242.00"
    )
    account_id = _cash_account_id(client, superuser_token_headers)
    before = _account_saldo(client, superuser_token_headers, account_id)

    receipt = _create_receipt(
        client,
        superuser_token_headers,
        "customer",
        customer["id"],
        _cash_method_id(db),
        "150.00",
    )

    assert receipt["document"]["contraparte_name"] == customer["razon_social"]
    assert receipt["document"]["total"] == "150.00"
    assert "RC-" in receipt["document"]["numero"]
    assert receipt["document"]["lines"] == []
    # FIFO: 121 to the oldest sale, 29 to the next one
    assert len(receipt["allocations"]) == 2
    by_doc = {a["document_id"]: Decimal(a["monto"]) for a in receipt["allocations"]}
    assert by_doc[first["id"]] == Decimal("121.00")
    assert by_doc[second["id"]] == Decimal("29.00")
    # cash account +150 (cobro)
    assert _account_saldo(
        client, superuser_token_headers, account_id
    ) == before + Decimal("150.00")
    # customer balance reduced by the receipt total
    assert _customer_saldo(client, superuser_token_headers, customer["id"]) == Decimal(
        "92.00"
    )
    # the receipt shows up in the current-account ledger with its own number
    movements = _customer_movements(
        client, superuser_token_headers, customer["id"], limit=100
    )["data"]
    receipt_mov = next(
        m for m in movements if m["document_id"] == receipt["document"]["id"]
    )
    assert Decimal(receipt_mov["monto"]) == Decimal("-150.00")
    assert receipt_mov["document_numero"] == receipt["document"]["numero"]
    # outstanding reflects the remaining portion
    outstanding = _outstanding(
        client, superuser_token_headers, "customer", customer["id"]
    )["data"]
    assert len(outstanding) == 1
    assert outstanding[0]["document_id"] == second["id"]
    assert outstanding[0]["pendiente"] == "92.00"


def test_partial_receipt_leaves_remaining_pending(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    product = _create_product(client, superuser_token_headers)
    customer = _create_customer(client, superuser_token_headers)
    sale = _create_sale(client, superuser_token_headers, product["id"], customer["id"])

    _create_receipt(
        client,
        superuser_token_headers,
        "customer",
        customer["id"],
        _cash_method_id(db),
        "50.00",
    )
    assert _customer_saldo(client, superuser_token_headers, customer["id"]) == Decimal(
        "71.00"
    )
    outstanding = _outstanding(
        client, superuser_token_headers, "customer", customer["id"]
    )["data"]
    assert len(outstanding) == 1
    assert outstanding[0]["document_id"] == sale["id"]
    assert outstanding[0]["pendiente"] == "71.00"


def test_receipt_overpayment_creates_credit_in_favor(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    product = _create_product(client, superuser_token_headers)
    customer = _create_customer(client, superuser_token_headers)
    sale = _create_sale(client, superuser_token_headers, product["id"], customer["id"])
    account_id = _cash_account_id(client, superuser_token_headers)
    before = _account_saldo(client, superuser_token_headers, account_id)

    receipt = _create_receipt(
        client,
        superuser_token_headers,
        "customer",
        customer["id"],
        _cash_method_id(db),
        "200.00",
    )
    assert _account_saldo(
        client, superuser_token_headers, account_id
    ) == before + Decimal("200.00")
    # the excess stays as an on-account credit (negative balance)
    assert _customer_saldo(client, superuser_token_headers, customer["id"]) == Decimal(
        "-79.00"
    )
    # only the outstanding portion is allocated; the rest is on account
    assert len(receipt["allocations"]) == 1
    assert receipt["allocations"][0]["document_id"] == sale["id"]
    assert Decimal(receipt["allocations"][0]["monto"]) == Decimal("121.00")
    assert (
        _outstanding(client, superuser_token_headers, "customer", customer["id"])[
            "count"
        ]
        == 0
    )


def test_supplier_receipt_pays_oldest_purchase(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    product = _create_product(client, superuser_token_headers)
    supplier = _create_supplier(client, superuser_token_headers)
    purchase = _create_purchase(
        client, superuser_token_headers, product["id"], supplier["id"]
    )
    assert _supplier_saldo(client, superuser_token_headers, supplier["id"]) == Decimal(
        "200.00"
    )
    account_id = _cash_account_id(client, superuser_token_headers)
    before = _account_saldo(client, superuser_token_headers, account_id)

    receipt = _create_receipt(
        client,
        superuser_token_headers,
        "supplier",
        supplier["id"],
        _cash_method_id(db),
        "200.00",
    )
    assert "RP-" in receipt["document"]["numero"]
    assert len(receipt["allocations"]) == 1
    assert receipt["allocations"][0]["document_id"] == purchase["id"]
    assert _account_saldo(
        client, superuser_token_headers, account_id
    ) == before - Decimal("200.00")
    assert _supplier_saldo(client, superuser_token_headers, supplier["id"]) == Decimal(
        "0"
    )
    page = _account_movements(client, superuser_token_headers, limit=100)
    mov = next(m for m in page["data"] if m["document_id"] == receipt["document"]["id"])
    assert mov["tipo"] == "pago"
    assert mov["monto"] == "-200.00"


def test_receipt_with_commission(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    product = _create_product(client, superuser_token_headers)
    customer = _create_customer(client, superuser_token_headers)
    _create_sale(client, superuser_token_headers, product["id"], customer["id"])

    r = client.post(
        f"{settings.API_V1_STR}/financial-accounts/",
        headers=superuser_token_headers,
        json={"name": "Banco Receipt Test"},
    )
    assert r.status_code == 200, r.text
    bank_account = r.json()
    r = client.post(
        f"{settings.API_V1_STR}/payment-methods/",
        headers=superuser_token_headers,
        json={
            "name": "Tarjeta Receipt Test",
            "financial_account_id": bank_account["id"],
        },
    )
    assert r.status_code == 200, r.text
    card_method = r.json()

    r = client.post(
        f"{settings.API_V1_STR}/payments/",
        headers=superuser_token_headers,
        json={
            "contraparte_type": "customer",
            "contraparte_id": customer["id"],
            "payments": [
                {
                    "payment_method_id": card_method["id"],
                    "monto": "121.00",
                    "comision_pct": "3.00",
                }
            ],
        },
    )
    assert r.status_code == 200, r.text
    receipt = r.json()
    # bank account: cobro +121.00 and comision -3.63
    assert _account_saldo(
        client, superuser_token_headers, bank_account["id"]
    ) == Decimal("117.37")
    assert _customer_saldo(client, superuser_token_headers, customer["id"]) == Decimal(
        "0"
    )
    page = _account_movements(client, superuser_token_headers, limit=100)
    movements = [
        m for m in page["data"] if m["document_id"] == receipt["document"]["id"]
    ]
    assert {m["tipo"] for m in movements} == {"cobro", "comision"}
    comision = next(m for m in movements if m["tipo"] == "comision")
    assert comision["monto"] == "-3.63"


def test_receipt_rejects_current_account_method(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    r = client.post(
        f"{settings.API_V1_STR}/financial-accounts/",
        headers=superuser_token_headers,
        json={"name": "CTA Receipt Test"},
    )
    assert r.status_code == 200, r.text
    r = client.post(
        f"{settings.API_V1_STR}/payment-methods/",
        headers=superuser_token_headers,
        json={
            "name": "Cuenta Receipt Test",
            "financial_account_id": r.json()["id"],
            "marks_paid": False,
        },
    )
    assert r.status_code == 200, r.text

    r = client.post(
        f"{settings.API_V1_STR}/payments/",
        headers=superuser_token_headers,
        json={
            "contraparte_type": "customer",
            "contraparte_id": customer["id"],
            "payments": [{"payment_method_id": r.json()["id"], "monto": "100.00"}],
        },
    )
    assert r.status_code == 400, r.text
    assert r.json()["detail"]["code"] == "receipt_requires_paid_method"
    assert _customer_saldo(client, superuser_token_headers, customer["id"]) == Decimal(
        "0"
    )


def test_receipt_rejects_unknown_method(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    r = client.post(
        f"{settings.API_V1_STR}/payments/",
        headers=superuser_token_headers,
        json={
            "contraparte_type": "customer",
            "contraparte_id": customer["id"],
            "payments": [
                {
                    "payment_method_id": "00000000-0000-0000-0000-000000000000",
                    "monto": "10.00",
                }
            ],
        },
    )
    assert r.status_code == 400, r.text
    assert r.json()["detail"]["code"] == "payment_method_not_found"


def test_outstanding_excludes_paid_and_voided_documents(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    product = _create_product(client, superuser_token_headers)
    customer = _create_customer(client, superuser_token_headers)
    paid = _create_sale(
        client,
        superuser_token_headers,
        product["id"],
        customer["id"],
        payments=[{"payment_method_id": _cash_method_id(db), "monto": "121.00"}],
    )
    unpaid = _create_sale(
        client, superuser_token_headers, product["id"], customer["id"]
    )
    voided = _create_sale(
        client, superuser_token_headers, product["id"], customer["id"]
    )
    r = client.post(
        f"{settings.API_V1_STR}/documents/{voided['id']}/void",
        headers=superuser_token_headers,
        json={"lines": [], "payments": []},
    )
    assert r.status_code == 200, r.text

    outstanding = _outstanding(
        client, superuser_token_headers, "customer", customer["id"]
    )
    assert outstanding["count"] == 1
    assert outstanding["data"][0]["document_id"] == unpaid["id"]
    assert outstanding["data"][0]["pendiente"] == "121.00"
    assert paid["id"] not in [d["document_id"] for d in outstanding["data"]]


def test_receipt_allocations_endpoint(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    product = _create_product(client, superuser_token_headers)
    customer = _create_customer(client, superuser_token_headers)
    sale = _create_sale(client, superuser_token_headers, product["id"], customer["id"])
    receipt = _create_receipt(
        client,
        superuser_token_headers,
        "customer",
        customer["id"],
        _cash_method_id(db),
        "121.00",
    )

    r = client.get(
        f"{settings.API_V1_STR}/payments/{receipt['document']['id']}/allocations",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200, r.text
    assert len(r.json()) == 1
    assert r.json()[0]["document_id"] == sale["id"]
    assert r.json()[0]["numero"] == sale["numero"]
    assert r.json()[0]["monto"] == "121.00"


def test_document_allocations_endpoint_shows_receipt_imputations(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    product = _create_product(client, superuser_token_headers)
    customer = _create_customer(client, superuser_token_headers)
    sale = _create_sale(client, superuser_token_headers, product["id"], customer["id"])
    receipt = _create_receipt(
        client,
        superuser_token_headers,
        "customer",
        customer["id"],
        _cash_method_id(db),
        "121.00",
    )

    r = client.get(
        f"{settings.API_V1_STR}/documents/{sale['id']}/allocations",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200, r.text
    assert len(r.json()) == 1
    assert r.json()[0]["receipt_document_id"] == receipt["document"]["id"]
    assert r.json()[0]["receipt_numero"] == receipt["document"]["numero"]
    assert r.json()[0]["monto"] == "121.00"

    # a document without imputations returns an empty list
    r = client.get(
        f"{settings.API_V1_STR}/documents/{receipt['document']['id']}/allocations",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json() == []


def test_receipt_before_sale_is_imputed_when_sale_is_created(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    product = _create_product(client, superuser_token_headers)
    customer = _create_customer(client, superuser_token_headers)

    # receipt issued before any sale: the full amount stays on account
    receipt = _create_receipt(
        client,
        superuser_token_headers,
        "customer",
        customer["id"],
        _cash_method_id(db),
        "100.00",
    )
    assert _customer_saldo(client, superuser_token_headers, customer["id"]) == Decimal(
        "-100.00"
    )

    # a later credit sale is imputed to the receipt automatically
    sale = _create_sale(
        client, superuser_token_headers, product["id"], customer["id"]
    )  # 121.00
    assert sale["favor_monto"] == "0.00"
    assert _customer_saldo(client, superuser_token_headers, customer["id"]) == Decimal(
        "21.00"
    )

    r = client.get(
        f"{settings.API_V1_STR}/payments/{receipt['document']['id']}/allocations",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200, r.text
    assert len(r.json()) == 1
    assert r.json()[0]["document_id"] == sale["id"]
    assert r.json()[0]["monto"] == "100.00"

    r = client.get(
        f"{settings.API_V1_STR}/documents/{sale['id']}/allocations",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()[0]["receipt_numero"] == receipt["document"]["numero"]

    rows = _outstanding(client, superuser_token_headers, "customer", customer["id"])
    assert len(rows["data"]) == 1
    assert rows["data"][0]["document_id"] == sale["id"]
    assert rows["data"][0]["pendiente"] == "21.00"


def test_receipt_leftovers_allocated_fifo_across_sales(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    product = _create_product(client, superuser_token_headers)
    customer = _create_customer(client, superuser_token_headers)

    rc1 = _create_receipt(
        client,
        superuser_token_headers,
        "customer",
        customer["id"],
        _cash_method_id(db),
        "60.00",
    )
    rc2 = _create_receipt(
        client,
        superuser_token_headers,
        "customer",
        customer["id"],
        _cash_method_id(db),
        "60.00",
    )
    assert _customer_saldo(client, superuser_token_headers, customer["id"]) == Decimal(
        "-120.00"
    )

    sale = _create_sale(
        client, superuser_token_headers, product["id"], customer["id"]
    )  # 121.00
    assert sale["favor_monto"] == "0.00"

    for receipt, expected in ((rc1, "60.00"), (rc2, "60.00")):
        r = client.get(
            f"{settings.API_V1_STR}/payments/{receipt['document']['id']}/allocations",
            headers=superuser_token_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()[0]["document_id"] == sale["id"]
        assert r.json()[0]["monto"] == expected

    rows = _outstanding(client, superuser_token_headers, "customer", customer["id"])
    assert rows["data"][0]["pendiente"] == "1.00"


def test_non_receipt_favor_keeps_favor_monto_residual(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    product = _create_product(client, superuser_token_headers)
    customer = _create_customer(client, superuser_token_headers)

    # 60.00 from a receipt + 79.00 from an overpaid sale = 139.00 in favor
    receipt = _create_receipt(
        client,
        superuser_token_headers,
        "customer",
        customer["id"],
        _cash_method_id(db),
        "60.00",
    )
    _create_sale(
        client,
        superuser_token_headers,
        product["id"],
        customer["id"],
        payments=[{"payment_method_id": _cash_method_id(db), "monto": "200.00"}],
    )  # 121.00 total, 79.00 overpaid
    assert _customer_saldo(client, superuser_token_headers, customer["id"]) == Decimal(
        "-139.00"
    )

    # a 150.00 credit sale consumes 60.00 from the receipt and 79.00 as residual
    load_stock(client, superuser_token_headers, product["id"], "1")
    r = client.post(
        f"{settings.API_V1_STR}/documents/",
        headers=superuser_token_headers,
        json={
            "document_type_id": _doc_type_id(client, superuser_token_headers, "TCK"),
            "contraparte_id": customer["id"],
            "lines": [
                {
                    "product_id": product["id"],
                    "cantidad": "1",
                    "precio_unit": "150.00",
                }
            ],
            "payments": [],
        },
    )
    assert r.status_code == 200, r.text
    sale = r.json()
    assert sale["favor_monto"] == "79.00"
    assert _customer_saldo(client, superuser_token_headers, customer["id"]) == Decimal(
        "11.00"
    )

    r = client.get(
        f"{settings.API_V1_STR}/payments/{receipt['document']['id']}/allocations",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()[0]["monto"] == "60.00"

    rows = _outstanding(client, superuser_token_headers, "customer", customer["id"])
    assert rows["data"][0]["document_id"] == sale["id"]
    assert rows["data"][0]["pendiente"] == "11.00"


def test_supplier_receipt_before_purchase_is_imputed(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    product = _create_product(client, superuser_token_headers)
    supplier = _create_supplier(client, superuser_token_headers)

    receipt = _create_receipt(
        client,
        superuser_token_headers,
        "supplier",
        supplier["id"],
        _cash_method_id(db),
        "100.00",
    )
    assert _supplier_saldo(client, superuser_token_headers, supplier["id"]) == Decimal(
        "-100.00"
    )

    purchase = _create_purchase(
        client, superuser_token_headers, product["id"], supplier["id"]
    )  # 200.00 (2 x costo 100)
    assert purchase["favor_monto"] == "0.00"
    assert _supplier_saldo(client, superuser_token_headers, supplier["id"]) == Decimal(
        "100.00"
    )

    r = client.get(
        f"{settings.API_V1_STR}/payments/{receipt['document']['id']}/allocations",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()[0]["document_id"] == purchase["id"]
    assert r.json()[0]["monto"] == "100.00"

    rows = _outstanding(client, superuser_token_headers, "supplier", supplier["id"])
    assert len(rows["data"]) == 1
    assert rows["data"][0]["document_id"] == purchase["id"]
    assert rows["data"][0]["pendiente"] == "100.00"


def test_void_of_imputed_sale_keeps_allocations_and_restores_favor(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    product = _create_product(client, superuser_token_headers)
    customer = _create_customer(client, superuser_token_headers)

    receipt = _create_receipt(
        client,
        superuser_token_headers,
        "customer",
        customer["id"],
        _cash_method_id(db),
        "100.00",
    )
    sale = _create_sale(
        client, superuser_token_headers, product["id"], customer["id"]
    )  # 121.00
    assert _customer_saldo(client, superuser_token_headers, customer["id"]) == Decimal(
        "21.00"
    )

    r = client.post(
        f"{settings.API_V1_STR}/documents/{sale['id']}/void",
        headers=superuser_token_headers,
        json={"lines": [], "payments": []},
    )
    assert r.status_code == 200, r.text
    # the NC reverses the balance: the favor is restored
    assert _customer_saldo(client, superuser_token_headers, customer["id"]) == Decimal(
        "-100.00"
    )
    # the allocation remains as historical traceability
    r = client.get(
        f"{settings.API_V1_STR}/payments/{receipt['document']['id']}/allocations",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()[0]["document_id"] == sale["id"]
    assert r.json()[0]["monto"] == "100.00"


def test_receipt_requires_active_counterpart(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    product = _create_product(client, superuser_token_headers)
    customer = _create_customer(client, superuser_token_headers)
    _create_sale(client, superuser_token_headers, product["id"], customer["id"])
    r = client.delete(
        f"{settings.API_V1_STR}/customers/{customer['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200, r.text

    r = client.post(
        f"{settings.API_V1_STR}/payments/",
        headers=superuser_token_headers,
        json={
            "contraparte_type": "customer",
            "contraparte_id": customer["id"],
            "payments": [{"payment_method_id": _cash_method_id(db), "monto": "10.00"}],
        },
    )
    assert r.status_code == 400, r.text
    assert r.json()["detail"]["code"] == "counterpart_inactive"


def test_outstanding_requires_existing_counterpart(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.get(
        f"{settings.API_V1_STR}/payments/outstanding",
        headers=superuser_token_headers,
        params={
            "contraparte_type": "customer",
            "contraparte_id": "00000000-0000-0000-0000-000000000000",
        },
    )
    assert r.status_code == 404, r.text
