from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete

from app.core.config import settings
from app.core.db import engine, init_db
from app.main import app
from app.models import (
    CONSUMIDOR_FINAL_NAME,
    Attribute,
    AttributeValue,
    Barcode,
    Category,
    Customer,
    Item,
    Product,
    ProductTax,
    ProductVariant,
    ProductVariantAttribute,
    Role,
    Supplier,
    Tax,
    UoM,
    User,
)
from tests.utils.user import authentication_token_from_email
from tests.utils.utils import get_superuser_token_headers

# Rows created by init_db seeds that must survive the test-session teardown.
SEED_TAX_CODES = ["IVA21", "IVA105", "IVA27", "IVA0", "EXENTO"]
SEED_UOM_NAME = "unidad"
SEED_ADMIN_ROLE = "Administrador"
SEED_CONSUMIDOR_FINAL = CONSUMIDOR_FINAL_NAME


@pytest.fixture(scope="session", autouse=True)
def db() -> Generator[Session]:
    with Session(engine) as session:
        init_db(session)
        yield session
        # Teardown: delete test-created rows in FK-safe order, keeping the
        # init_db seeds (taxes, "unidad" UoM, "Administrador" role, permissions).
        for model in (
            Item,
            User,
            ProductVariantAttribute,
            ProductVariant,
            Barcode,
            ProductTax,
            Product,
            Category,
            AttributeValue,
            Attribute,
        ):
            session.execute(delete(model))
        session.execute(delete(Tax).where(col(Tax.code).not_in(SEED_TAX_CODES)))  # type: ignore[attr-defined]
        session.execute(delete(UoM).where(col(UoM.name) != SEED_UOM_NAME))
        session.execute(delete(Role).where(col(Role.name) != SEED_ADMIN_ROLE))
        session.execute(
            delete(Customer).where(col(Customer.razon_social) != SEED_CONSUMIDOR_FINAL)
        )
        session.execute(delete(Supplier))
        session.commit()


@pytest.fixture(scope="module")
def client() -> Generator[TestClient]:
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def superuser_token_headers(client: TestClient) -> dict[str, str]:
    return get_superuser_token_headers(client)


@pytest.fixture(scope="module")
def normal_user_token_headers(client: TestClient, db: Session) -> dict[str, str]:
    return authentication_token_from_email(
        client=client, email=settings.EMAIL_TEST_USER, db=db
    )
