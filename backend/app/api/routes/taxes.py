import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import col, func, select

from app.api.deps import PaginationDep, SessionDep, require_permissions
from app.models import Message, Page, Tax, TaxCreate, TaxPublic, TaxUpdate

router = APIRouter(prefix="/taxes", tags=["taxes"])


@router.get(
    "/",
    response_model=Page[TaxPublic],
    dependencies=[require_permissions("product.read")],
)
def read_taxes(session: SessionDep, pagination: PaginationDep) -> Any:
    """Retrieve taxes."""
    count = session.exec(select(func.count()).select_from(Tax)).one()
    taxes = session.exec(
        select(Tax).offset(pagination.skip).limit(pagination.limit)
    ).all()
    return Page[TaxPublic](
        data=[TaxPublic.model_validate(t) for t in taxes], count=count
    )


@router.post(
    "/",
    response_model=TaxPublic,
    dependencies=[require_permissions("settings.update")],
)
def create_tax(*, session: SessionDep, tax_in: TaxCreate) -> Any:
    """Create a tax."""
    existing = session.exec(select(Tax).where(col(Tax.code) == tax_in.code)).first()
    if existing:
        raise HTTPException(
            status_code=400, detail="A tax with this code already exists"
        )
    tax = Tax.model_validate(tax_in)
    session.add(tax)
    session.commit()
    session.refresh(tax)
    return tax


@router.patch(
    "/{tax_id}",
    response_model=TaxPublic,
    dependencies=[require_permissions("settings.update")],
)
def update_tax(*, session: SessionDep, tax_id: uuid.UUID, tax_in: TaxUpdate) -> Any:
    """Update a tax."""
    tax = session.get(Tax, tax_id)
    if not tax:
        raise HTTPException(status_code=404, detail="Tax not found")
    data = tax_in.model_dump(exclude_unset=True)
    if data.get("code"):
        existing = session.exec(
            select(Tax).where(col(Tax.code) == data["code"], col(Tax.id) != tax_id)
        ).first()
        if existing:
            raise HTTPException(
                status_code=400, detail="A tax with this code already exists"
            )
    tax.sqlmodel_update(data)
    session.add(tax)
    session.commit()
    session.refresh(tax)
    return tax


@router.delete(
    "/{tax_id}",
    response_model=Message,
    dependencies=[require_permissions("settings.update")],
)
def delete_tax(session: SessionDep, tax_id: uuid.UUID) -> Any:
    """Delete a tax."""
    tax = session.get(Tax, tax_id)
    if not tax:
        raise HTTPException(status_code=404, detail="Tax not found")
    session.delete(tax)
    session.commit()
    return Message(message="Tax deleted successfully")
