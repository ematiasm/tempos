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
    CONSUMIDOR_FINAL_NAME,
    AccountMovement,
    Attribute,
    AttributeValue,
    Backup,
    BackupSchedule,
    Barcode,
    BusinessSettings,
    CashRegisterSession,
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
    PaymentMethod,
    Product,
    ProductVariant,
    Role,
    StockMovement,
    Supplier,
    SupplierAccountMovement,
    Tax,
    TaxCondition,
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
    CashRegisterSession,
    DocumentType,
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


def _seed_setup_defaults(session: Session) -> None:
    """Re-seed the rows tests assume but ``init_db`` no longer creates.

    The first-run /setup flow owns the BusinessSettings singleton and the
    protected "Consumidor Final" customer now; tests exercise the configured
    state, so restore them when missing (e.g. after a test deleted them to
    simulate a fresh install).
    """
    if not session.exec(select(BusinessSettings)).first():
        session.add(
            BusinessSettings(
                business_name="My Business",
                condicion_fiscal=TaxCondition.CONSUMIDOR_FINAL,
            )
        )
    if not session.exec(
        select(Customer).where(Customer.razon_social == CONSUMIDOR_FINAL_NAME)
    ).first():
        session.add(
            Customer(
                razon_social=CONSUMIDOR_FINAL_NAME,
                condicion_fiscal=TaxCondition.CONSUMIDOR_FINAL,
            )
        )
    session.commit()


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
        _seed_setup_defaults(session)
    except Exception:
        # Never leave the session in an aborted transaction: a failed cleanup
        # would poison every later test in the session.
        session.rollback()
        raise


@pytest.fixture(scope="session", autouse=True)
def db() -> Generator[Session]:
    with Session(engine) as session:
        init_db(session)
        _seed_setup_defaults(session)
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


@pytest.fixture(scope="function", autouse=True)
def open_cash_session(db: Session) -> Generator[None]:
    """Every test starts with an open daily cash session.

    Sales (operation ``venta``) require an open session; tests that exercise
    the session lifecycle close/reopen it explicitly. The float source is
    resolved the same way the app does (the cash-drawer method's account) so
    every test keeps the previous same-account (no-movement) semantics.
    """
    from decimal import Decimal

    from app import crud
    from app.models import CashSessionOpenCreate, User

    opener = db.exec(select(User).where(User.email == settings.FIRST_SUPERUSER)).one()
    drawer = crud._cash_drawer_account(db)  # noqa: SLF001
    crud.open_cash_session(
        session=db,
        open_in=CashSessionOpenCreate(
            opening_amount=Decimal("0"),
            opening_source_account_id=drawer.id,
        ),
        user_id=opener.id,
    )
    yield
