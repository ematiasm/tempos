"""First-run setup endpoints.

The system is "not configured" until a ``BusinessSettings`` row exists: the
setup flow replaces the old auto-seeded placeholder settings and default
customer. ``GET /setup/status`` reports configuration state; ``POST /setup``
(superuser only) creates the business settings, the protected default
customer and — optionally — the demo data, in one transaction.
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Field, SQLModel, select

from app.api.deps import SessionDep, get_current_active_superuser, get_current_user
from app.demo_data import load_demo_data
from app.models import (
    CONSUMIDOR_FINAL_NAME,
    BusinessSettings,
    BusinessSettingsPublic,
    Customer,
    LocalePreference,
    TaxCondition,
)

router = APIRouter(prefix="/setup", tags=["setup"])


class SetupCreate(SQLModel):
    """First-run setup payload.

    Identity fields mirror the ``BusinessSettingsUpdate`` schema used by the
    Admin General tab; the business name and fiscal condition are required and
    every other field keeps its model default.
    """

    business_name: str = Field(min_length=1, max_length=255)
    address: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=50)
    email: str | None = Field(default=None, max_length=255)
    cuit: str | None = Field(default=None, max_length=20)
    condicion_fiscal: TaxCondition
    # Optional first-run language choice; NULL keeps the model default.
    default_locale: LocalePreference | None = None
    load_demo_data: bool = False


class SetupStatusPublic(SQLModel):
    setup_completed: bool


@router.get(
    "/status",
    response_model=SetupStatusPublic,
    dependencies=[Depends(get_current_user)],
)
def read_setup_status(session: SessionDep) -> Any:
    """Whether the first-run setup has been completed."""
    return SetupStatusPublic(
        setup_completed=session.exec(select(BusinessSettings)).first() is not None
    )


@router.post(
    "/",
    response_model=BusinessSettingsPublic,
    dependencies=[Depends(get_current_active_superuser)],
)
def run_setup(session: SessionDep, setup_in: SetupCreate) -> Any:
    """Complete the first-run setup (superuser only).

    Creates the business settings singleton and the protected default
    customer; when ``load_demo_data`` is true it also loads the demo catalog
    and counterparties. Everything happens in a single transaction.
    """
    if session.exec(select(BusinessSettings)).first() is not None:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "setup_already_completed",
                "message": "The first-run setup has already been completed",
            },
        )
    data = setup_in.model_dump(exclude_unset=True)
    load_demo = bool(data.pop("load_demo_data", False))
    business = BusinessSettings.model_validate(data)
    session.add(business)
    session.add(
        Customer(
            razon_social=CONSUMIDOR_FINAL_NAME,
            condicion_fiscal=TaxCondition.CONSUMIDOR_FINAL,
        )
    )
    if load_demo:
        load_demo_data(session)
    session.commit()
    session.refresh(business)
    return business
