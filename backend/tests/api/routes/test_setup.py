"""Tests for the first-run /setup endpoints."""

from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete, select

from app.core.config import settings
from app.demo_data import (
    DEMO_CATEGORIES,
    DEMO_CUSTOMER_NAME,
    DEMO_PRODUCTS,
    DEMO_SUPPLIER_CUIT,
    DEMO_SUPPLIER_NAME,
)
from app.models import (
    CONSUMIDOR_FINAL_NAME,
    Barcode,
    BusinessSettings,
    Category,
    Customer,
    Product,
    ProductTax,
    Supplier,
    Tax,
    TaxCondition,
)

SETUP_URL = f"{settings.API_V1_STR}/setup"
STATUS_URL = f"{SETUP_URL}/status"

DEMO_PRODUCT_NAMES = {name for name, *_ in DEMO_PRODUCTS}
DEMO_PRODUCT_BARCODES = {barcode for *_rest, barcode in DEMO_PRODUCTS}


def _fresh_install(db: Session) -> None:
    """Simulate a fresh install: no settings row, no default customer."""
    db.execute(delete(BusinessSettings))
    db.execute(
        delete(Customer).where(col(Customer.razon_social) == CONSUMIDOR_FINAL_NAME)
    )
    db.commit()


def test_setup_status_false_on_fresh_install(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    _fresh_install(db)
    r = client.get(STATUS_URL, headers=superuser_token_headers)
    assert r.status_code == 200
    assert r.json() == {"setup_completed": False}


def test_business_settings_404_before_setup(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    """Reading settings pre-setup must 404, never lazily create the row."""
    _fresh_install(db)
    r = client.get(
        f"{settings.API_V1_STR}/business-settings/", headers=superuser_token_headers
    )
    assert r.status_code == 404, r.text
    assert r.json()["detail"]["code"] == "setup_not_completed"
    assert db.exec(select(BusinessSettings)).first() is None


def test_setup_creates_settings_and_default_customer(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    _fresh_install(db)
    r = client.post(
        SETUP_URL,
        headers=superuser_token_headers,
        json={
            "business_name": "Mi Comercio",
            "condicion_fiscal": "Consumidor Final",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["business_name"] == "Mi Comercio"
    assert body["condicion_fiscal"] == "Consumidor Final"

    assert db.exec(select(BusinessSettings)).first() is not None
    default_customer = db.exec(
        select(Customer).where(Customer.razon_social == CONSUMIDOR_FINAL_NAME)
    ).first()
    assert default_customer is not None
    assert default_customer.condicion_fiscal == TaxCondition.CONSUMIDOR_FINAL
    assert default_customer.documento is None

    r = client.get(STATUS_URL, headers=superuser_token_headers)
    assert r.status_code == 200
    assert r.json() == {"setup_completed": True}


def test_setup_rejected_when_already_completed(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    _fresh_install(db)
    r = client.post(
        SETUP_URL,
        headers=superuser_token_headers,
        json={
            "business_name": "Mi Comercio",
            "condicion_fiscal": "Consumidor Final",
        },
    )
    assert r.status_code == 200, r.text

    r = client.post(
        SETUP_URL,
        headers=superuser_token_headers,
        json={"business_name": "Otro Comercio", "condicion_fiscal": "RI"},
    )
    assert r.status_code == 409, r.text
    assert r.json()["detail"]["code"] == "setup_already_completed"


def test_setup_with_demo_data(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    _fresh_install(db)

    # Baselines: the demo loader is additive and idempotent (rows matching
    # existing names/codes are skipped), and _fresh_install does not wipe the
    # catalog. On a volume that already holds demo-named data (e.g. manual dev
    # rows), assertions must target the DELTA this load introduces and the
    # freshly created rows — never the absolute catalog state.
    pre_products = db.exec(select(Product)).all()
    pre_demo_products = [p for p in pre_products if p.name in DEMO_PRODUCT_NAMES]
    pre_demo_count = len(pre_demo_products)
    pre_demo_names = {p.name for p in pre_demo_products}
    pre_product_ids = {p.id for p in pre_products}
    pre_demo_barcodes = {
        b.code
        for b in db.exec(select(Barcode)).all()
        if b.code.startswith("7790001000")
    }
    pre_demo_customer = db.exec(
        select(Customer).where(col(Customer.razon_social) == DEMO_CUSTOMER_NAME)
    ).first()
    pre_demo_supplier = db.exec(
        select(Supplier).where(col(Supplier.razon_social) == DEMO_SUPPLIER_NAME)
    ).first()

    r = client.post(
        SETUP_URL,
        headers=superuser_token_headers,
        json={
            "business_name": "Comercio Demo",
            "condicion_fiscal": "Consumidor Final",
            "load_demo_data": True,
        },
    )
    assert r.status_code == 200, r.text

    products = db.exec(select(Product)).all()
    demo_products = [p for p in products if p.name in DEMO_PRODUCT_NAMES]
    # The loader creates exactly one product per missing demo name; rows that
    # already existed persist untouched.
    missing_demo_names = DEMO_PRODUCT_NAMES - pre_demo_names
    assert len(demo_products) == pre_demo_count + len(missing_demo_names)

    # Freshly loaded demo products start with zero stock and carry the seeded
    # IVA21 line tax. Pre-existing demo-named rows are skipped by the loader,
    # so their stock/links stay whatever the volume already had.
    fresh_products = [p for p in demo_products if p.id not in pre_product_ids]
    assert {p.name for p in fresh_products} == missing_demo_names
    assert all(p.stock_current == Decimal("0") for p in fresh_products)

    demo_category_names = {
        c.name
        for c in db.exec(
            select(Category).where(col(Category.name).in_(DEMO_CATEGORIES))
        ).all()
    }
    assert demo_category_names == set(DEMO_CATEGORIES)

    codes = [
        b.code
        for b in db.exec(select(Barcode)).all()
        if b.code.startswith("7790001000")
    ]
    # The loader adds exactly the demo barcodes that were not present yet.
    missing_demo_barcodes = DEMO_PRODUCT_BARCODES - pre_demo_barcodes
    assert len(codes) == len(pre_demo_barcodes) + len(missing_demo_barcodes)
    assert set(codes) == pre_demo_barcodes | missing_demo_barcodes
    assert len(set(codes)) == len(codes)

    # Every freshly loaded demo product carries the seeded IVA21 line tax.
    iva21_tax = db.exec(select(Tax).where(col(Tax.code) == "IVA21")).first()
    assert iva21_tax is not None
    linked_product_ids = set(
        db.exec(
            select(ProductTax.product_id).where(col(ProductTax.tax_id) == iva21_tax.id)
        ).all()
    )
    assert all(p.id in linked_product_ids for p in fresh_products)

    demo_customer = db.exec(
        select(Customer).where(col(Customer.razon_social) == DEMO_CUSTOMER_NAME)
    ).first()
    assert demo_customer is not None
    if pre_demo_customer is None:
        assert demo_customer.condicion_fiscal == TaxCondition.CONSUMIDOR_FINAL

    demo_supplier = db.exec(
        select(Supplier).where(col(Supplier.razon_social) == DEMO_SUPPLIER_NAME)
    ).first()
    assert demo_supplier is not None
    if pre_demo_supplier is None:
        assert demo_supplier.documento == DEMO_SUPPLIER_CUIT


def test_setup_requires_superuser(
    client: TestClient, db: Session, normal_user_token_headers: dict[str, str]
) -> None:
    _fresh_install(db)
    r = client.post(
        SETUP_URL,
        headers=normal_user_token_headers,
        json={
            "business_name": "Mi Comercio",
            "condicion_fiscal": "Consumidor Final",
        },
    )
    assert r.status_code == 403
