import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import col, func, select

from app.api.deps import PaginationDep, SessionDep, require_permissions
from app.models import (
    Message,
    Page,
    Supplier,
    SupplierCreate,
    SupplierPublic,
    SupplierUpdate,
)

router = APIRouter(prefix="/suppliers", tags=["suppliers"])


@router.get(
    "/",
    response_model=Page[SupplierPublic],
    dependencies=[require_permissions("supplier.read")],
)
def read_suppliers(session: SessionDep, pagination: PaginationDep) -> Any:
    """Retrieve suppliers."""
    count = session.exec(select(func.count()).select_from(Supplier)).one()
    suppliers = session.exec(
        select(Supplier).offset(pagination.skip).limit(pagination.limit)
    ).all()
    return Page[SupplierPublic](
        data=[SupplierPublic.model_validate(s) for s in suppliers], count=count
    )


@router.get(
    "/{supplier_id}",
    response_model=SupplierPublic,
    dependencies=[require_permissions("supplier.read")],
)
def read_supplier(session: SessionDep, supplier_id: uuid.UUID) -> Any:
    """Get a specific supplier by id."""
    supplier = session.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return supplier


@router.post(
    "/",
    response_model=SupplierPublic,
    dependencies=[require_permissions("supplier.create")],
)
def create_supplier(*, session: SessionDep, supplier_in: SupplierCreate) -> Any:
    """Create a new supplier."""
    if supplier_in.documento:
        existing = session.exec(
            select(Supplier).where(col(Supplier.documento) == supplier_in.documento)
        ).first()
        if existing:
            raise HTTPException(
                status_code=400,
                detail="A supplier with this document already exists",
            )
    supplier = Supplier.model_validate(supplier_in)
    session.add(supplier)
    session.commit()
    session.refresh(supplier)
    return supplier


@router.patch(
    "/{supplier_id}",
    response_model=SupplierPublic,
    dependencies=[require_permissions("supplier.update")],
)
def update_supplier(
    *, session: SessionDep, supplier_id: uuid.UUID, supplier_in: SupplierUpdate
) -> Any:
    """Update a supplier."""
    supplier = session.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    data = supplier_in.model_dump(exclude_unset=True)
    if data.get("documento"):
        existing = session.exec(
            select(Supplier).where(
                col(Supplier.documento) == data["documento"],
                col(Supplier.id) != supplier_id,
            )
        ).first()
        if existing:
            raise HTTPException(
                status_code=400,
                detail="A supplier with this document already exists",
            )
    supplier.sqlmodel_update(data)
    session.add(supplier)
    session.commit()
    session.refresh(supplier)
    return supplier


@router.delete(
    "/{supplier_id}",
    response_model=Message,
    dependencies=[require_permissions("supplier.delete")],
)
def delete_supplier(session: SessionDep, supplier_id: uuid.UUID) -> Any:
    """Deactivate a supplier (soft delete)."""
    supplier = session.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    supplier.is_active = False
    session.add(supplier)
    session.commit()
    return Message(message="Supplier deactivated successfully")
