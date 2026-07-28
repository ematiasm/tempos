import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import func, select

from app.api.deps import PaginationDep, SessionDep, require_permissions
from app.models import (
    Category,
    CategoryCreate,
    CategoryPublic,
    CategoryUpdate,
    Message,
    Page,
)

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get(
    "/",
    response_model=Page[CategoryPublic],
    dependencies=[require_permissions("category.read")],
)
def read_categories(session: SessionDep, pagination: PaginationDep) -> Any:
    """Retrieve categories."""
    count = session.exec(select(func.count()).select_from(Category)).one()
    categories = session.exec(
        select(Category).offset(pagination.skip).limit(pagination.limit)
    ).all()
    return Page[CategoryPublic](
        data=[CategoryPublic.model_validate(c) for c in categories], count=count
    )


@router.post(
    "/",
    response_model=CategoryPublic,
    dependencies=[require_permissions("category.create")],
)
def create_category(*, session: SessionDep, category_in: CategoryCreate) -> Any:
    """Create a category."""
    if category_in.parent_id and not session.get(Category, category_in.parent_id):
        raise HTTPException(status_code=400, detail="Parent category not found")
    category = Category.model_validate(category_in)
    session.add(category)
    session.commit()
    session.refresh(category)
    return category


@router.get(
    "/{category_id}",
    response_model=CategoryPublic,
    dependencies=[require_permissions("category.read")],
)
def read_category(session: SessionDep, category_id: uuid.UUID) -> Any:
    """Get a specific category by id."""
    category = session.get(Category, category_id)
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    return category


@router.patch(
    "/{category_id}",
    response_model=CategoryPublic,
    dependencies=[require_permissions("category.update")],
)
def update_category(
    *, session: SessionDep, category_id: uuid.UUID, category_in: CategoryUpdate
) -> Any:
    """Update a category."""
    category = session.get(Category, category_id)
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    if category_in.parent_id:
        if category_in.parent_id == category_id:
            raise HTTPException(
                status_code=400, detail="A category cannot be its own parent"
            )
        if not session.get(Category, category_in.parent_id):
            raise HTTPException(status_code=400, detail="Parent category not found")
    update_data = category_in.model_dump(exclude_unset=True)
    category.sqlmodel_update(update_data)
    session.add(category)
    session.commit()
    session.refresh(category)
    return category


@router.delete(
    "/{category_id}",
    response_model=Message,
    dependencies=[require_permissions("category.delete")],
)
def delete_category(session: SessionDep, category_id: uuid.UUID) -> Any:
    """Delete a category. Products in it keep their category_id set to NULL."""
    category = session.get(Category, category_id)
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    session.delete(category)
    session.commit()
    return Message(message="Category deleted successfully")
