from typing import Any

from fastapi import APIRouter
from sqlmodel import func, select

from app.api.deps import PaginationDep, SessionDep, require_permissions
from app.models import Page, Permission, PermissionPublic

router = APIRouter(prefix="/permissions", tags=["permissions"])


@router.get(
    "/",
    response_model=Page[PermissionPublic],
    dependencies=[require_permissions("permission.read")],
)
def read_permissions(session: SessionDep, pagination: PaginationDep) -> Any:
    """Retrieve all available permissions."""
    count = session.exec(select(func.count()).select_from(Permission)).one()
    permissions = session.exec(
        select(Permission).offset(pagination.skip).limit(pagination.limit)
    ).all()
    return Page[PermissionPublic](
        data=[PermissionPublic.model_validate(p) for p in permissions],
        count=count,
    )
