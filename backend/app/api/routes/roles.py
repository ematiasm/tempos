import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import col, delete, func, select

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
    role = Role(name=role_in.name, description=role_in.description)
    session.add(role)
    session.commit()
    session.refresh(role)
    for perm_id in role_in.permission_ids:
        perm = session.get(Permission, perm_id)
        if perm:
            session.add(RolePermission(role_id=role.id, permission_id=perm_id))
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
        session.exec(
            delete(RolePermission).where(col(RolePermission.role_id) == role_id)
        )
        for perm_id in permission_ids:
            perm = session.get(Permission, perm_id)
            if perm:
                session.add(RolePermission(role_id=role_id, permission_id=perm_id))
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
