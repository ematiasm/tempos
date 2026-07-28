import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlalchemy.orm import selectinload
from sqlmodel import col, func, select

from app import crud
from app.api.deps import PaginationDep, SessionDep, require_permissions
from app.models import (
    Attribute,
    AttributeCreate,
    AttributePublic,
    AttributeUpdate,
    AttributeValue,
    Message,
    Page,
    ProductVariantAttribute,
)

router = APIRouter(prefix="/attributes", tags=["attributes"])


def _attribute_in_use(session: SessionDep, attribute_id: uuid.UUID) -> bool:
    """Return True if any value of the attribute is referenced by a variant."""
    return (
        session.exec(
            select(ProductVariantAttribute)
            .join(
                AttributeValue,
                col(ProductVariantAttribute.attribute_value_id) == AttributeValue.id,
            )
            .where(col(AttributeValue.attribute_id) == attribute_id)
        ).first()
        is not None
    )


@router.get(
    "/",
    response_model=Page[AttributePublic],
    dependencies=[require_permissions("product.read")],
)
def read_attributes(session: SessionDep, pagination: PaginationDep) -> Any:
    """Retrieve attributes with their values."""
    count = session.exec(select(func.count()).select_from(Attribute)).one()
    attributes = session.exec(
        select(Attribute)
        .options(selectinload(Attribute.values))  # type: ignore
        .offset(pagination.skip)
        .limit(pagination.limit)
    ).all()
    return Page[AttributePublic](
        data=[AttributePublic.model_validate(a) for a in attributes], count=count
    )


@router.post(
    "/",
    response_model=AttributePublic,
    dependencies=[require_permissions("settings.update")],
)
def create_attribute(*, session: SessionDep, attribute_in: AttributeCreate) -> Any:
    """Create an attribute with its initial values."""
    attribute = crud.create_attribute(session=session, attribute_in=attribute_in)
    return attribute


@router.patch(
    "/{attribute_id}",
    response_model=AttributePublic,
    dependencies=[require_permissions("settings.update")],
)
def update_attribute(
    *, session: SessionDep, attribute_id: uuid.UUID, attribute_in: AttributeUpdate
) -> Any:
    """Update an attribute name and/or sync its values.

    Values absent from ``values`` are removed unless referenced by a variant.
    """
    attribute = session.get(Attribute, attribute_id)
    if not attribute:
        raise HTTPException(status_code=404, detail="Attribute not found")
    data = attribute_in.model_dump(exclude_unset=True)
    values = data.pop("values", None) if "values" in data else None
    if data:
        attribute.sqlmodel_update(data)
        session.add(attribute)
        session.commit()
    if values is not None:
        try:
            crud.sync_attribute_values(
                session=session, attribute=attribute, values=values
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
    session.refresh(attribute)
    return attribute


@router.delete(
    "/{attribute_id}",
    response_model=Message,
    dependencies=[require_permissions("settings.update")],
)
def delete_attribute(session: SessionDep, attribute_id: uuid.UUID) -> Any:
    """Delete an attribute unless any of its values is used by a variant."""
    attribute = session.get(Attribute, attribute_id)
    if not attribute:
        raise HTTPException(status_code=404, detail="Attribute not found")
    if _attribute_in_use(session, attribute_id):
        raise HTTPException(
            status_code=400,
            detail="Attribute is in use by product variants",
        )
    session.delete(attribute)
    session.commit()
    return Message(message="Attribute deleted successfully")
