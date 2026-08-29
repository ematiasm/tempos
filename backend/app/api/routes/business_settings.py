from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from sqlmodel import select

from app.api.deps import SessionDep, require_permissions
from app.core.config import settings
from app.models import (
    BusinessSettings,
    BusinessSettingsPublic,
    BusinessSettingsUpdate,
)

router = APIRouter(prefix="/business-settings", tags=["business-settings"])

ALLOWED_LOGO_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".svg"}
MAX_LOGO_BYTES = 2 * 1024 * 1024


def _get_settings(session: SessionDep) -> BusinessSettings:
    bs = session.exec(select(BusinessSettings)).first()
    if not bs:
        # The singleton row is created by the first-run setup flow, never
        # lazily here: an accidental read must not silently complete setup.
        raise HTTPException(
            status_code=404,
            detail={
                "code": "setup_not_completed",
                "message": "The first-run setup has not been completed yet",
            },
        )
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


@router.post(
    "/logo",
    response_model=BusinessSettingsPublic,
    dependencies=[require_permissions("settings.update")],
)
def upload_logo(session: SessionDep, file: UploadFile = File(...)) -> Any:
    """Upload the business logo shown on printed vouchers."""
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_LOGO_EXTS:
        raise HTTPException(
            status_code=400, detail="Unsupported image format (use png/jpg/webp/svg)"
        )
    content = file.file.read(MAX_LOGO_BYTES + 1)
    if len(content) > MAX_LOGO_BYTES:
        raise HTTPException(status_code=400, detail="Image too large (max 2 MB)")
    upload_dir = Path(settings.UPLOAD_DIR)
    upload_dir.mkdir(parents=True, exist_ok=True)
    new_path = upload_dir / f"logo{ext}"
    new_path.write_bytes(content)
    bs = _get_settings(session)
    if bs.logo_path:
        old = upload_dir / Path(bs.logo_path).name
        if old != new_path:
            old.unlink(missing_ok=True)
    bs.logo_path = f"/uploads/logo{ext}"
    session.add(bs)
    session.commit()
    session.refresh(bs)
    return bs


@router.delete(
    "/logo",
    status_code=204,
    dependencies=[require_permissions("settings.update")],
)
def delete_logo(session: SessionDep) -> None:
    """Remove the business logo."""
    bs = _get_settings(session)
    if bs.logo_path:
        (Path(settings.UPLOAD_DIR) / Path(bs.logo_path).name).unlink(missing_ok=True)
        bs.logo_path = None
        session.add(bs)
        session.commit()
