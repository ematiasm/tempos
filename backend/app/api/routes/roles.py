import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import Session, col, delete, func, select

from app.api.deps import PaginationDep, SessionDep, require_permissions
from app.models import (
    Message,
    Page,
    Permission,
    Role,
    RoleCreate,
    RolePermission,
    RolePublic,
    RoleUpdate,
)

router = APIRouter(prefix="/roles", tags=["roles"])


def _validate_permission_ids(
    session: Session, permission_ids: list[uuid.UUID]
) -> list[Permission]:
    """Validate that every permission id exists, returning the rows.

    Raises 400 listing the unknown ids instead of silently dropping them.
    """
    if not permission_ids:
        return []
    found = session.exec(
        select(Permission).where(col(Permission.id).in_(permission_ids))
    ).all()
    found_ids = {perm.id for perm in found}
    missing = [str(pid) for pid in permission_ids if pid not in found_ids]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown permission ids: {', '.join(missing)}",
        )
    return list(found)


@router.get(
    "/",
    response_model=Page[RolePublic],
    dependencies=[require_permissions("role.read")],
)
def read_roles(session: SessionDep, pagination: PaginationDep) -> Any:
    """Retrieve roles."""
    count = session.exec(select(func.count()).select_from(Role)).one()
    roles = session.exec(
        select(Role).offset(pagination.skip).limit(pagination.limit)
    ).all()
    return Page[RolePublic](
        data=[RolePublic.model_validate(r) for r in roles], count=count
    )


@router.post(
    "/",
    response_model=RolePublic,
    dependencies=[require_permissions("role.create")],
)
def create_role(*, session: SessionDep, role_in: RoleCreate) -> Any:
    """Create a new role."""
    existing = session.exec(select(Role).where(Role.name == role_in.name)).first()
    if existing:
        raise HTTPException(
            status_code=400,
            detail="A role with this name already exists",
        )
    perms = _validate_permission_ids(session, role_in.permission_ids)
    role = Role(name=role_in.name, description=role_in.description)
    session.add(role)
    session.commit()
    session.refresh(role)
    for perm in perms:
        session.add(RolePermission(role_id=role.id, permission_id=perm.id))
    session.commit()
    session.refresh(role)
    return role


@router.get(
    "/{role_id}",
    response_model=RolePublic,
    dependencies=[require_permissions("role.read")],
)
def read_role(session: SessionDep, role_id: uuid.UUID) -> Any:
    """Get a specific role by id."""
    role = session.get(Role, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    return role


@router.patch(
    "/{role_id}",
    response_model=RolePublic,
    dependencies=[require_permissions("role.update")],
)
def update_role(*, session: SessionDep, role_id: uuid.UUID, role_in: RoleUpdate) -> Any:
    """Update a role."""
    role = session.get(Role, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    if role_in.name:
        existing = session.exec(
            select(Role).where(Role.name == role_in.name, Role.id != role_id)
        ).first()
        if existing:
            raise HTTPException(
                status_code=400,
                detail="A role with this name already exists",
            )
    update_data = role_in.model_dump(exclude_unset=True)
    permission_ids = update_data.pop("permission_ids", None)
    role.sqlmodel_update(update_data)
    session.add(role)
    session.commit()
    session.refresh(role)
    if permission_ids is not None:
        perms = _validate_permission_ids(session, permission_ids)
        session.exec(
            delete(RolePermission).where(col(RolePermission.role_id) == role_id)
        )
        for perm in perms:
            session.add(RolePermission(role_id=role_id, permission_id=perm.id))
        session.commit()
        session.refresh(role)
    return role


@router.delete(
    "/{role_id}",
    dependencies=[require_permissions("role.delete")],
)
def delete_role(session: SessionDep, role_id: uuid.UUID) -> Message:
    """Delete a role."""
    role = session.get(Role, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    if role.name == "Administrador":
        raise HTTPException(
            status_code=400,
            detail="The 'Administrador' role cannot be deleted",
        )
    session.delete(role)
    session.commit()
    return Message(message="Role deleted successfully")
