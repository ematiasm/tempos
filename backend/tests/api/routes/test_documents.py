"""Tests for the /documents endpoints."""

import re
import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app import crud
from app.core.config import settings
from app.models import (
    AccountMovement,
    AccountMovementType,
    PaymentMethod,
    Role,
    SupplierAccountMovement,
    UserCreate,
)
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


def _create_product(
    client: TestClient,
    headers: dict[str, str],
    *,
    costo: str = "100.00",
    margen: str = "21.00",
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


def _create_customer(
    client: TestClient, headers: dict[str, str], condicion: str = "RI"
) -> dict:
    r = client.post(
        f"{settings.API_V1_STR}/customers/",
        headers=headers,
        json={
            "razon_social": random_lower_string()[:20],
            "condicion_fiscal": condicion,
        },
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


def _iva21_id(client: TestClient, headers: dict[str, str]) -> str:
    r = client.get(f"{settings.API_V1_STR}/taxes/", headers=headers)
    return next(row for row in r.json()["data"] if row["code"] == "IVA21")["id"]


def _cash_method_id(db: Session) -> str:
    method = db.exec(
        select(PaymentMethod).where(PaymentMethod.name == "Efectivo")
    ).first()
    assert method is not None, "Seeded cash payment method not found"
    return str(method.id)


def _create_doc(client: TestClient, headers: dict[str, str], payload: dict) -> dict:
    r = client.post(f"{settings.API_V1_STR}/documents/", headers=headers, json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def test_create_sale_document_computes_totals_and_taxes(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    iva21 = _iva21_id(client, superuser_token_headers)
    product = _create_product(
        client, superuser_token_headers, tax_ids=[iva21]
    )  # precio_venta = 121.00
    load_stock(client, superuser_token_headers, product["id"], "3")
    type_id = _doc_type_id(client, superuser_token_headers, "TCK")
    payload = {
        "document_type_id": type_id,
        "contraparte_id": customer["id"],
        "descuento_total": "10.00",
        "lines": [
            {
                "product_id": product["id"],
                "cantidad": "2",
                "descuento_pct": "10",  # 2 * 121 = 242 - 24.20 = 217.80
            },
            {
                "product_id": product["id"],
                "cantidad": "1",
                "precio_unit": "100.00",
                "descuento_monto": "10.00",  # 100 - 10 = 90
            },
        ],
        "payments": [{"payment_method_id": _cash_method_id(db), "monto": "297.80"}],
    }
    doc = _create_doc(client, superuser_token_headers, payload)

    # totals: subtotal 217.80 + 90.00 = 307.80; total = 307.80 - 10.00
    assert doc["subtotal"] == "307.80"
    assert doc["descuento_total"] == "10.00"
    assert doc["total"] == "297.80"
    assert doc["estado"] == "active"
    assert doc["contraparte_name"] == customer["razon_social"]
    assert doc["contraparte_type"] == "customer"

    # lines: computed values + cost snapshot
    lines = sorted(doc["lines"], key=lambda x: x["orden"])
    assert lines[0]["subtotal_line"] == "217.80"
    assert lines[0]["descuento_monto"] == "24.20"
    assert lines[0]["costo_unitario"] == "100.00"
    assert lines[1]["subtotal_line"] == "90.00"
    assert lines[1]["precio_unit"] == "100.00"

    # IVA 21 breakdown is informational (prices carry IVA inside)
    for line in lines:
        iva = next(t for t in line["taxes"] if t["tax_id"] == iva21)
        assert iva["aplicado"] is True
        expected = str(
            (Decimal(line["subtotal_line"]) * Decimal("0.21")).quantize(Decimal("0.01"))
        )
        assert iva["monto"] == expected

    # line-level taxes are not aggregated to DocumentTax
    # (only document-level percepciones land there)
    assert doc["taxes"] == []

    assert len(doc["payments"]) == 1
    assert doc["payments"][0]["monto"] == "297.80"


def _create_debit_method(client: TestClient, headers: dict[str, str]) -> dict:
    """A marks_paid method that is NOT the cash drawer (e.g. debit card)."""
    r = client.post(
        f"{settings.API_V1_STR}/financial-accounts/",
        headers=headers,
        json={"name": random_lower_string()[:12]},
    )
    assert r.status_code == 200, r.text
    account_id = r.json()["id"]
    r = client.post(
        f"{settings.API_V1_STR}/payment-methods/",
        headers=headers,
        json={
            "name": random_lower_string()[:12],
            "financial_account_id": account_id,
            "marks_paid": True,
            "is_cash_drawer": False,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def _documents_count(client: TestClient, headers: dict[str, str]) -> int:
    r = client.get(f"{settings.API_V1_STR}/documents/", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["count"]


def _customer_saldo_str(
    client: TestClient, headers: dict[str, str], customer_id: str
) -> str:
    r = client.get(f"{settings.API_V1_STR}/customers/{customer_id}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["saldo"]


def _supplier_saldo_str(
    client: TestClient, headers: dict[str, str], supplier_id: str
) -> str:
    r = client.get(f"{settings.API_V1_STR}/suppliers/{supplier_id}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["saldo"]


def test_credit_exceeds_total_rejected(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    """Credit rows above the unpaid remainder are rejected (400), no document.

    Today the balance math silently truncates the credit row (row says 900,
    ledger books 800); the spec forbids the silent truncation.
    """
    customer = _create_customer(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)
    credit_method = db.exec(
        select(PaymentMethod).where(PaymentMethod.name == "Crédito")
    ).first()
    assert credit_method is not None, "Seeded credit payment method not found"
    tck = _doc_type_id(client, superuser_token_headers, "TCK")
    payload = {
        "document_type_id": tck,
        "contraparte_id": customer["id"],
        "lines": [
            {
                "product_id": product["id"],
                "cantidad": "1",
                "precio_unit": "1000.00",
                "tax_ids": [],
            }
        ],
        "payments": [
            {"payment_method_id": _cash_method_id(db), "monto": "200.00"},
            {"payment_method_id": str(credit_method.id), "monto": "900.00"},
        ],
    }
    count_before = _documents_count(client, superuser_token_headers)
    r = client.post(
        f"{settings.API_V1_STR}/documents/",
        headers=superuser_token_headers,
        json=payload,
    )
    assert r.status_code == 400, r.text
    assert r.json()["detail"]["code"] == "credit_exceeds_total"
    # no document may be created and no balance change may leak
    assert _documents_count(client, superuser_token_headers) == count_before
    assert _customer_saldo_str(client, superuser_token_headers, customer["id"]) in (
        "0.00",
        "0",
    )


def test_non_cash_payment_exceeds_total_rejected(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """A non-cash paid row above the total is rejected (400), no document.

    Today the excess silently becomes credit in favor for the customer; the
    spec forbids non-cash overpayment.
    """
    customer = _create_customer(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)
    debit = _create_debit_method(client, superuser_token_headers)
    tck = _doc_type_id(client, superuser_token_headers, "TCK")
    payload = {
        "document_type_id": tck,
        "contraparte_id": customer["id"],
        "lines": [
            {
                "product_id": product["id"],
                "cantidad": "1",
                "precio_unit": "1000.00",
                "tax_ids": [],
            }
        ],
        "payments": [{"payment_method_id": debit["id"], "monto": "1100.00"}],
    }
    count_before = _documents_count(client, superuser_token_headers)
    r = client.post(
        f"{settings.API_V1_STR}/documents/",
        headers=superuser_token_headers,
        json=payload,
    )
    assert r.status_code == 400, r.text
    assert r.json()["detail"]["code"] == "payment_exceeds_total"
    assert _documents_count(client, superuser_token_headers) == count_before
    assert _customer_saldo_str(client, superuser_token_headers, customer["id"]) in (
        "0.00",
        "0",
    )


def test_full_cash_overpay_stays_permissive(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    """Regression guard: a full cash overpay keeps the on-account semantics."""
    customer = _create_customer(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)
    tck = _doc_type_id(client, superuser_token_headers, "TCK")
    payload = {
        "document_type_id": tck,
        "contraparte_id": customer["id"],
        "lines": [
            {
                "product_id": product["id"],
                "cantidad": "1",
                "precio_unit": "1000.00",
                "tax_ids": [],
            }
        ],
        "payments": [{"payment_method_id": _cash_method_id(db), "monto": "1200.00"}],
    }
    doc = _create_doc(client, superuser_token_headers, payload)
    assert doc["total"] == "1000.00"
    assert doc["payments"][0]["monto"] == "1200.00"
    # excess 200 stays as the customer's credit in favor (negative saldo)
    assert _customer_saldo_str(client, superuser_token_headers, customer["id"]) == (
        "-200.00"
    )


def test_purchase_split_payment_multiple_methods_and_debt(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    """A purchase paid across several methods: each marks_paid row books one
    AccountMovement, a Crédito row books none, and the unpaid remainder stays
    on the supplier balance (we owe it)."""
    product = _create_product(client, superuser_token_headers)
    supplier = _create_supplier(client, superuser_token_headers)
    oc = _doc_type_id(client, superuser_token_headers, "OC")
    debit = _create_debit_method(client, superuser_token_headers)
    credit_method = db.exec(
        select(PaymentMethod).where(PaymentMethod.name == "Crédito")
    ).first()
    assert credit_method is not None, "Seeded credit payment method not found"

    doc = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": oc,
            "contraparte_id": supplier["id"],
            "lines": [{"product_id": product["id"], "cantidad": "2"}],  # 200.00
            "payments": [
                {"payment_method_id": _cash_method_id(db), "monto": "60.00"},
                {"payment_method_id": debit["id"], "monto": "90.00"},
                {"payment_method_id": str(credit_method.id), "monto": "30.00"},
            ],
        },
    )
    assert doc["total"] == "200.00"
    assert len(doc["payments"]) == 3

    # one account movement per marks_paid row; the Crédito row books none
    movements = db.exec(
        select(AccountMovement).where(AccountMovement.document_id == doc["id"])
    ).all()
    assert [str(m.monto) for m in movements] == ["-60.00", "-90.00"]
    assert all(m.tipo == AccountMovementType.PAGO for m in movements)

    # unpaid remainder (200 - 150) stays as debt owed to the supplier
    assert _supplier_saldo_str(client, superuser_token_headers, supplier["id"]) in (
        "50.00",
        "50",
    )
    supplier_movs = db.exec(
        select(SupplierAccountMovement).where(
            SupplierAccountMovement.document_id == doc["id"]
        )
    ).all()
    assert [str(m.monto) for m in supplier_movs] == ["50.00"]


def test_purchase_full_cash_overpay_stays_permissive(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    """Regression guard (mirror of the sale case): a purchase fully paid in
    cash above its total is allowed and the excess books as credit in our
    favor (negative supplier balance); a non-cash overpay stays rejected.
    """
    product = _create_product(client, superuser_token_headers)
    supplier = _create_supplier(client, superuser_token_headers)
    oc = _doc_type_id(client, superuser_token_headers, "OC")

    doc = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": oc,
            "contraparte_id": supplier["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],  # 100.00
            "payments": [
                {"payment_method_id": _cash_method_id(db), "monto": "150.00"}
            ],
        },
    )
    assert doc["total"] == "100.00"
    assert doc["payments"][0]["monto"] == "150.00"
    # excess 50 stays as credit in our favor (negative supplier balance)
    assert _supplier_saldo_str(client, superuser_token_headers, supplier["id"]) in (
        "-50.00",
        "-50",
    )

    # a non-cash overpay is still rejected (payment_exceeds_total)
    supplier2 = _create_supplier(client, superuser_token_headers)
    debit = _create_debit_method(client, superuser_token_headers)
    count_before = _documents_count(client, superuser_token_headers)
    r = client.post(
        f"{settings.API_V1_STR}/documents/",
        headers=superuser_token_headers,
        json={
            "document_type_id": oc,
            "contraparte_id": supplier2["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],
            "payments": [{"payment_method_id": debit["id"], "monto": "150.00"}],
        },
    )
    assert r.status_code == 400, r.text
    assert r.json()["detail"]["code"] == "payment_exceeds_total"
    assert _documents_count(client, superuser_token_headers) == count_before


def test_favor_auto_coverage_with_effective_cash_row(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    """Pinned contract (gate for the split-payment UX): total 1000, customer
    saldo −200, cash row 800 (the effective amount after the frontend caps
    the vuelto) → favor_monto 200 and the balance nets to zero; the vuelto
    (100) never reaches the ledger.
    """
    customer = _create_customer(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)
    tck = _doc_type_id(client, superuser_token_headers, "TCK")

    # the customer ends with 200.00 credit in favor
    seed = {
        "document_type_id": tck,
        "contraparte_id": customer["id"],
        "lines": [
            {
                "product_id": product["id"],
                "cantidad": "1",
                "precio_unit": "1000.00",
                "tax_ids": [],
            }
        ],
        "payments": [{"payment_method_id": _cash_method_id(db), "monto": "1200.00"}],
    }
    _create_doc(client, superuser_token_headers, seed)
    assert _customer_saldo_str(client, superuser_token_headers, customer["id"]) == (
        "-200.00"
    )

    # sale of 1000 with the effective cash row 800: the unpaid 200 is covered
    # by the credit in favor
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
                    "precio_unit": "1000.00",
                    "tax_ids": [],
                }
            ],
            "payments": [{"payment_method_id": _cash_method_id(db), "monto": "800.00"}],
        },
    )
    assert doc["favor_monto"] == "200.00"
    assert doc["payments"][0]["monto"] == "800.00"
    assert _customer_saldo_str(client, superuser_token_headers, customer["id"]) in (
        "0.00",
        "0",
    )


def test_document_numbering_sequential_per_type(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "2")
    type_id = _doc_type_id(client, superuser_token_headers, "TCK")
    payload = {
        "document_type_id": type_id,
        "contraparte_id": customer["id"],
        "lines": [{"product_id": product["id"], "cantidad": "1"}],
    }
    first = _create_doc(client, superuser_token_headers, payload)
    second = _create_doc(client, superuser_token_headers, payload)

    pattern = re.compile(r"^\d{4}-TCK-(\d{8})$")
    m1, m2 = pattern.match(first["numero"]), pattern.match(second["numero"])
    assert m1 and m2
    assert int(m2.group(1)) == int(m1.group(1)) + 1


def test_numbering_defaults_to_current_year(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    from datetime import datetime

    customer = _create_customer(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)
    type_id = _doc_type_id(client, superuser_token_headers, "COT")
    doc = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": type_id,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],
        },
    )
    assert doc["year"] == datetime.now().year
    assert doc["numero"].startswith(f"{datetime.now().year}-COT-")


def test_document_level_percepciones_add_to_total(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    # IIBB percepción, 3%, applies at document level
    r = client.post(
        f"{settings.API_V1_STR}/taxes/",
        headers=superuser_token_headers,
        json={
            "name": "Perc IIBB",
            "code": random_lower_string()[:8].upper(),
            "tipo": "IIBB",
            "rate": "3.00",
            "is_percent": True,
            "aplica_a": "documento",
        },
    )
    assert r.status_code == 200, r.text
    iibb_id = r.json()["id"]
    product = _create_product(client, superuser_token_headers, tax_ids=[iibb_id])
    load_stock(client, superuser_token_headers, product["id"], "2")
    type_id = _doc_type_id(client, superuser_token_headers, "TCK")
    doc = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": type_id,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "2"}],  # 242.00
        },
    )
    # percepción computed and added on top of the subtotal
    doc_tax = next(t for t in doc["taxes"] if t["tax_id"] == iibb_id)
    assert doc_tax["base"] == "242.00"
    assert doc_tax["monto"] == "7.26"
    assert doc["total"] == "249.26"


def test_line_tax_override_removes_taxes_from_line(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    iva21 = _iva21_id(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers, tax_ids=[iva21])
    load_stock(client, superuser_token_headers, product["id"], "1")
    type_id = _doc_type_id(client, superuser_token_headers, "TCK")
    doc = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": type_id,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1", "tax_ids": []}],
        },
    )
    assert doc["lines"][0]["taxes"] == []


def test_create_document_validation_errors(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    supplier = _create_supplier(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)
    tck = _doc_type_id(client, superuser_token_headers, "TCK")
    ajs = _doc_type_id(client, superuser_token_headers, "AJS")
    base = {"lines": [{"product_id": product["id"], "cantidad": "1"}]}

    # sale type without a counterpart
    r = client.post(
        f"{settings.API_V1_STR}/documents/",
        headers=superuser_token_headers,
        json={**base, "document_type_id": tck},
    )
    assert r.status_code == 400
    assert "requires a counterpart" in r.json()["detail"]["message"]

    # supplier id used as a customer
    r = client.post(
        f"{settings.API_V1_STR}/documents/",
        headers=superuser_token_headers,
        json={**base, "document_type_id": tck, "contraparte_id": supplier["id"]},
    )
    assert r.status_code == 400
    assert "Counterpart not found" in r.json()["detail"]["message"]

    # adjustment type does not take a counterpart
    r = client.post(
        f"{settings.API_V1_STR}/documents/",
        headers=superuser_token_headers,
        json={**base, "document_type_id": ajs, "contraparte_id": customer["id"]},
    )
    assert r.status_code == 400
    assert "does not take a counterpart" in r.json()["detail"]["message"]

    # document discount above subtotal
    r = client.post(
        f"{settings.API_V1_STR}/documents/",
        headers=superuser_token_headers,
        json={
            **base,
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "descuento_total": "99999.00",
        },
    )
    assert r.status_code == 400
    assert "exceeds" in r.json()["detail"]["message"]


def test_suggest_fiscal_sale_type(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    settings_url = f"{settings.API_V1_STR}/business-settings/"
    customer_ri = _create_customer(client, superuser_token_headers, "RI")
    customer_cf = _create_customer(client, superuser_token_headers, "Consumidor Final")

    def _suggest(customer_id: str) -> str:
        r = client.get(
            f"{settings.API_V1_STR}/documents/suggest-type",
            headers=superuser_token_headers,
            params={"customer_id": customer_id},
        )
        assert r.status_code == 200, r.text
        return r.json()["name"]

    # business Consumidor Final (seeded default) → always Factura C
    client.patch(
        settings_url,
        headers=superuser_token_headers,
        json={"condicion_fiscal": "Consumidor Final"},
    )
    assert _suggest(customer_ri["id"]) == "Factura C"
    assert _suggest(customer_cf["id"]) == "Factura C"

    # RI business: RI customer → A, others → B
    client.patch(
        settings_url,
        headers=superuser_token_headers,
        json={"condicion_fiscal": "RI"},
    )
    assert _suggest(customer_ri["id"]) == "Factura A"
    assert _suggest(customer_cf["id"]) == "Factura B"

    # Monotributo business → C
    client.patch(
        settings_url,
        headers=superuser_token_headers,
        json={"condicion_fiscal": "Monotributo"},
    )
    assert _suggest(customer_ri["id"]) == "Factura C"

    # restore the seeded default
    client.patch(
        settings_url,
        headers=superuser_token_headers,
        json={"condicion_fiscal": "Consumidor Final"},
    )


def test_payment_methods_seeded(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.get(
        f"{settings.API_V1_STR}/payment-methods/",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    names = {row["name"] for row in r.json()["data"]}
    assert "Efectivo" in names


def test_read_document_detail(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "1")
    type_id = _doc_type_id(client, superuser_token_headers, "TCK")
    doc = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": type_id,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],
        },
    )
    r = client.get(
        f"{settings.API_V1_STR}/documents/{doc['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["numero"] == doc["numero"]
    assert body["document_type"]["name"] == "Ticket"
    assert body["lines"][0]["product_id"] == product["id"]
    assert body["lines"][0]["product_name"] == product["name"]

    # list also includes it
    r = client.get(f"{settings.API_V1_STR}/documents/", headers=superuser_token_headers)
    assert r.status_code == 200
    listed = next(d for d in r.json()["data"] if d["id"] == doc["id"])
    assert listed["lines"][0]["product_name"] == product["name"]


def test_read_documents_filters_by_type_and_date_range(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "3")
    tck = _doc_type_id(client, superuser_token_headers, "TCK")
    cot = _doc_type_id(client, superuser_token_headers, "COT")
    base = {"contraparte_id": customer["id"]}

    older = _create_doc(
        client,
        superuser_token_headers,
        {
            **base,
            "document_type_id": cot,
            "fecha": "2025-01-15T12:00:00Z",
            "lines": [{"product_id": product["id"], "cantidad": "1"}],
        },
    )
    newer = _create_doc(
        client,
        superuser_token_headers,
        {
            **base,
            "document_type_id": tck,
            "fecha": "2025-06-20T12:00:00Z",
            "lines": [{"product_id": product["id"], "cantidad": "1"}],
        },
    )

    # by type
    r = client.get(
        f"{settings.API_V1_STR}/documents/",
        headers=superuser_token_headers,
        params={"document_type_id": tck, "limit": 100},
    )
    assert r.status_code == 200
    ids = {d["id"] for d in r.json()["data"]}
    assert newer["id"] in ids
    assert older["id"] not in ids

    # by date range (bounds inclusive business-local days)
    r = client.get(
        f"{settings.API_V1_STR}/documents/",
        headers=superuser_token_headers,
        params={
            "fecha_desde": "2025-01-01",
            "fecha_hasta": "2025-02-01",
            "limit": 100,
        },
    )
    assert r.status_code == 200
    ids = {d["id"] for d in r.json()["data"]}
    assert older["id"] in ids
    assert newer["id"] not in ids

    # combined: type + range only matches the newer document
    r = client.get(
        f"{settings.API_V1_STR}/documents/",
        headers=superuser_token_headers,
        params={
            "document_type_id": tck,
            "fecha_desde": "2025-01-01",
            "fecha_hasta": "2025-12-31",
            "limit": 100,
        },
    )
    assert r.status_code == 200
    ids = {d["id"] for d in r.json()["data"]}
    assert newer["id"] in ids
    assert older["id"] not in ids

    # count reflects the combined filter
    assert r.json()["count"] >= 1
    assert older["id"] not in {d["id"] for d in r.json()["data"]}


def test_read_documents_filters_by_user_and_creators(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "2")
    tck = _doc_type_id(client, superuser_token_headers, "TCK")
    base = {"contraparte_id": customer["id"]}

    superuser_doc = _create_doc(
        client,
        superuser_token_headers,
        {
            **base,
            "document_type_id": tck,
            "lines": [{"product_id": product["id"], "cantidad": "1"}],
        },
    )

    # second user with its own token creates another document
    password = random_lower_string()
    admin_role = db.exec(select(Role).where(Role.name == "Administrador")).first()
    assert admin_role is not None
    other = crud.create_user(
        session=db,
        user_create=UserCreate(
            email=random_email(),
            password=password,
            full_name="Filter User",
            role_ids=[admin_role.id],
        ),
    )
    r = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={"username": other.email, "password": password},
    )
    assert r.status_code == 200, r.text
    other_headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    other_doc = _create_doc(
        client,
        other_headers,
        {
            **base,
            "document_type_id": tck,
            "lines": [{"product_id": product["id"], "cantidad": "1"}],
        },
    )
    assert other_doc["user_id"] != superuser_doc["user_id"]

    # /documents/creators lists both creators
    r = client.get(
        f"{settings.API_V1_STR}/documents/creators",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    emails = {u["email"] for u in r.json()}
    assert settings.FIRST_SUPERUSER in emails
    assert other.email in emails

    # filter by the second user returns only their document
    r = client.get(
        f"{settings.API_V1_STR}/documents/",
        headers=superuser_token_headers,
        params={"user_id": str(other.id), "limit": 100},
    )
    assert r.status_code == 200
    ids = {d["id"] for d in r.json()["data"]}
    assert other_doc["id"] in ids
    assert superuser_doc["id"] not in ids

    # a random user id matches nothing
    r = client.get(
        f"{settings.API_V1_STR}/documents/",
        headers=superuser_token_headers,
        params={"user_id": str(uuid.uuid4()), "limit": 100},
    )
    assert r.status_code == 200
    assert r.json()["count"] == 0


def test_read_documents_filter_resolves_business_local_days(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """``fecha_desde``/``fecha_hasta`` are inclusive business-local days.

    A document with fecha 02:30 UTC is 23:30 business-local on the previous
    day (America/Argentina/Buenos_Aires, UTC-3): it must match that local day
    and not the calendar day of its UTC timestamp.
    """
    customer = _create_customer(client, superuser_token_headers)
    product = _create_product(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "1")
    tck = _doc_type_id(client, superuser_token_headers, "TCK")

    settings_url = f"{settings.API_V1_STR}/business-settings/"
    previous_tz = client.get(
        settings_url, headers=superuser_token_headers
    ).json()["timezone"]
    r = client.patch(
        settings_url,
        headers=superuser_token_headers,
        json={"timezone": "America/Argentina/Buenos_Aires"},
    )
    assert r.status_code == 200, r.text
    try:
        doc = _create_doc(
            client,
            superuser_token_headers,
            {
                "document_type_id": tck,
                "contraparte_id": customer["id"],
                "fecha": "2026-08-30T02:30:00Z",  # 23:30 local on 2026-08-29
                "lines": [{"product_id": product["id"], "cantidad": "1"}],
            },
        )

        r = client.get(
            f"{settings.API_V1_STR}/documents/",
            headers=superuser_token_headers,
            params={
                "fecha_desde": "2026-08-29",
                "fecha_hasta": "2026-08-29",
                "limit": 100,
            },
        )
        assert r.status_code == 200, r.text
        assert doc["id"] in {d["id"] for d in r.json()["data"]}

        # the previous local day does not include it
        r = client.get(
            f"{settings.API_V1_STR}/documents/",
            headers=superuser_token_headers,
            params={
                "fecha_desde": "2026-08-28",
                "fecha_hasta": "2026-08-28",
                "limit": 100,
            },
        )
        assert r.status_code == 200, r.text
        assert doc["id"] not in {d["id"] for d in r.json()["data"]}
    finally:
        client.patch(
            settings_url,
            headers=superuser_token_headers,
            json={"timezone": previous_tz},
        )
