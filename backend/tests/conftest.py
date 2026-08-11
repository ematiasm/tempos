from collections.abc import Generator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import tuple_
from sqlmodel import Session, SQLModel, delete, select

from app.core.config import settings
from app.core.db import engine, init_db
from app.main import app
from app.models import (
    AccountMovement,
    Attribute,
    AttributeValue,
    Backup,
    BackupSchedule,
    Barcode,
    BusinessSettings,
    Category,
    Customer,
    CustomerAccountMovement,
    Document,
    DocumentLine,
    DocumentLineTax,
    DocumentPayment,
    DocumentPaymentAllocation,
    DocumentSequence,
    DocumentTax,
    DocumentType,
    FinancialAccount,
    Item,
    PaymentMethod,
    Product,
    ProductVariant,
    Role,
    StockMovement,
    Supplier,
    SupplierAccountMovement,
    Tax,
    Transfer,
    UoM,
    User,
)
from tests.utils.user import authentication_token_from_email
from tests.utils.utils import get_superuser_token_headers

# Tables the tests can touch. Rows created during the test session are removed
# after each test; rows that already existed when the session started (init_db
# seeds, manual dev data) are preserved. Composite-PK link tables (ProductTax,
# ProductVariantAttribute, UserRole, RolePermission, SupplierProduct) are not
# listed here: their FK constraints cascade when the parent rows are deleted.
# Order matters: children before parents.
CLEANUP_MODELS: tuple[type[SQLModel], ...] = (
    StockMovement,
    AccountMovement,
    CustomerAccountMovement,
    SupplierAccountMovement,
    Transfer,
    DocumentLineTax,
    DocumentLine,
    DocumentTax,
    DocumentPayment,
    DocumentPaymentAllocation,
    Document,
    DocumentSequence,
    DocumentType,
    Item,
    Backup,
    ProductVariant,
    Barcode,
    Product,
    Category,
    AttributeValue,
    Attribute,
    User,
    Tax,
    UoM,
    Role,
    Customer,
    Supplier,
    PaymentMethod,
    FinancialAccount,
    BusinessSettings,
    BackupSchedule,
)

# Primary-key values that already existed when the pytest session started
# (seeds + any manual dev data). Anything not in this set is test-created.
_BASELINE: dict[type[SQLModel], set[tuple[Any, ...]]] = {}


def _primary_keys(model: type[SQLModel]) -> list[Any]:
    return list(model.__table__.primary_key.columns)


def _clean_test_data(session: Session) -> None:
    """Delete test-created rows (FK-safe order), keeping the session baseline."""
    try:
        for model in CLEANUP_MODELS:
            kept = _BASELINE.get(model)
            if kept:
                session.execute(
                    delete(model).where(tuple_(*_primary_keys(model)).not_in(kept))
                )
            else:
                session.execute(delete(model))
        session.commit()
        # Safety net: restore seed rows a test may have removed or renamed.
        init_db(session)
    except Exception:
        # Never leave the session in an aborted transaction: a failed cleanup
        # would poison every later test in the session.
        session.rollback()
        raise


@pytest.fixture(scope="session", autouse=True)
def db() -> Generator[Session]:
    with Session(engine) as session:
        init_db(session)
        for model in CLEANUP_MODELS:
            pk_cols = _primary_keys(model)
            rows = session.exec(select(*pk_cols)).all()
            if len(pk_cols) == 1:
                _BASELINE[model] = {(row,) for row in rows}
            else:
                _BASELINE[model] = {tuple(row) for row in rows}
        yield session


@pytest.fixture(scope="function", autouse=True)
def clean_db(db: Session) -> Generator[None]:
    yield
    _clean_test_data(db)


@pytest.fixture(scope="module")
def client() -> Generator[TestClient]:
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def superuser_token_headers(client: TestClient) -> dict[str, str]:
    return get_superuser_token_headers(client)


@pytest.fixture(scope="function")
def normal_user_token_headers(client: TestClient, db: Session) -> dict[str, str]:
    return authentication_token_from_email(
        client=client, email=settings.EMAIL_TEST_USER, db=db
    )
