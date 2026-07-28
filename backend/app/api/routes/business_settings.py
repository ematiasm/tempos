from typing import Any

from fastapi import APIRouter
from sqlmodel import select

from app.api.deps import SessionDep, require_permissions
from app.models import (
    BusinessSettings,
    BusinessSettingsPublic,
    BusinessSettingsUpdate,
)

router = APIRouter(prefix="/business-settings", tags=["business-settings"])


def _get_settings(session: SessionDep) -> BusinessSettings:
    bs = session.exec(select(BusinessSettings)).first()
    if not bs:
        bs = BusinessSettings(business_name="My Business")
        session.add(bs)
        session.commit()
        session.refresh(bs)
    return bs


@router.get(
    "/",
    response_model=BusinessSettingsPublic,
    dependencies=[require_permissions("settings.read")],
)
def read_business_settings(session: SessionDep) -> Any:
    """Get the business settings (singleton row)."""
    return _get_settings(session)


@router.patch(
    "/",
    response_model=BusinessSettingsPublic,
    dependencies=[require_permissions("settings.update")],
)
def update_business_settings(
    session: SessionDep, settings_in: BusinessSettingsUpdate
) -> Any:
    """Update the business settings."""
    bs = _get_settings(session)
    update_data = settings_in.model_dump(exclude_unset=True)
    bs.sqlmodel_update(update_data)
    session.add(bs)
    session.commit()
    session.refresh(bs)
    return bs
