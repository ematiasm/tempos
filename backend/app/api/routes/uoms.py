import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import func, select

from app.api.deps import PaginationDep, SessionDep, require_permissions
from app.models import Message, Page, UoM, UoMCreate, UoMPublic, UoMUpdate

router = APIRouter(prefix="/uoms", tags=["uoms"])


@router.get(
    "/",
    response_model=Page[UoMPublic],
    dependencies=[require_permissions("product.read")],
)
def read_uoms(session: SessionDep, pagination: PaginationDep) -> Any:
    """Retrieve units of measure."""
    count = session.exec(select(func.count()).select_from(UoM)).one()
    uoms = session.exec(
        select(UoM).offset(pagination.skip).limit(pagination.limit)
    ).all()
    return Page[UoMPublic](
        data=[UoMPublic.model_validate(u) for u in uoms], count=count
    )


@router.post(
    "/",
    response_model=UoMPublic,
    dependencies=[require_permissions("settings.update")],
)
def create_uom(*, session: SessionDep, uom_in: UoMCreate) -> Any:
    """Create a unit of measure."""
    uom = UoM.model_validate(uom_in)
    session.add(uom)
    session.commit()
    session.refresh(uom)
    return uom


@router.patch(
    "/{uom_id}",
    response_model=UoMPublic,
    dependencies=[require_permissions("settings.update")],
)
def update_uom(*, session: SessionDep, uom_id: uuid.UUID, uom_in: UoMUpdate) -> Any:
    """Update a unit of measure."""
    uom = session.get(UoM, uom_id)
    if not uom:
        raise HTTPException(status_code=404, detail="Unit of measure not found")
    update_data = uom_in.model_dump(exclude_unset=True)
    uom.sqlmodel_update(update_data)
    session.add(uom)
    session.commit()
    session.refresh(uom)
    return uom


@router.delete(
    "/{uom_id}",
    response_model=Message,
    dependencies=[require_permissions("settings.update")],
)
def delete_uom(session: SessionDep, uom_id: uuid.UUID) -> Any:
    """Delete a unit of measure (only if no products use it)."""
    uom = session.get(UoM, uom_id)
    if not uom:
        raise HTTPException(status_code=404, detail="Unit of measure not found")
    session.delete(uom)
    session.commit()
    return Message(message="Unit of measure deleted successfully")
