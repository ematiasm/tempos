import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import col, func, select

from app import crud
from app.api.deps import PaginationDep, SessionDep, require_permissions
from app.models import (
    Message,
    Page,
    Product,
    Supplier,
    SupplierProduct,
    SupplierProductCreate,
    SupplierProductPublic,
    SupplierProductUpdate,
)

router = APIRouter(prefix="/supplier-products", tags=["supplier-products"])


def _decorate(
    session: SessionDep, pairs: list[SupplierProduct]
) -> list[SupplierProductPublic]:
    """Resolve supplier and product names with two bulk queries."""
    supplier_ids = {p.supplier_id for p in pairs}
    product_ids = {p.product_id for p in pairs}
    supplier_names = {
        s.id: s.razon_social
        for s in session.exec(
            select(Supplier).where(col(Supplier.id).in_(supplier_ids))
        ).all()
    }
    product_names = {
        p.id: p.name
        for p in session.exec(
            select(Product).where(col(Product.id).in_(product_ids))
        ).all()
    }
    publics = []
    for pair in pairs:
        public = SupplierProductPublic.model_validate(pair)
        public.supplier_name = supplier_names.get(pair.supplier_id)
        public.product_name = product_names.get(pair.product_id)
        publics.append(public)
    return publics


@router.get(
    "/",
    response_model=Page[SupplierProductPublic],
    dependencies=[require_permissions("cost.read")],
)
def read_supplier_products(
    session: SessionDep,
    pagination: PaginationDep,
    supplier_id: uuid.UUID | None = None,
    product_id: uuid.UUID | None = None,
) -> Any:
    """Retrieve supplier-product costs, optionally filtered by either side."""
    conditions = []
    if supplier_id:
        conditions.append(col(SupplierProduct.supplier_id) == supplier_id)
    if product_id:
        conditions.append(col(SupplierProduct.product_id) == product_id)
    count = session.exec(
        select(func.count()).select_from(SupplierProduct).where(*conditions)
    ).one()
    pairs = session.exec(
        select(SupplierProduct)
        .where(*conditions)
        .order_by(col(SupplierProduct.created_at).desc())
        .offset(pagination.skip)
        .limit(pagination.limit)
    ).all()
    return Page[SupplierProductPublic](
        data=_decorate(session, list(pairs)), count=count
    )


@router.post(
    "/",
    response_model=SupplierProductPublic,
    dependencies=[require_permissions("cost.create")],
)
def create_supplier_product(
    *, session: SessionDep, supplier_product_in: SupplierProductCreate
) -> Any:
    """Register a supplier cost for a product."""
    try:
        pair = crud.create_supplier_product(
            session=session, supplier_product_in=supplier_product_in
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return _decorate(session, [pair])[0]


@router.patch(
    "/{supplier_id}/{product_id}",
    response_model=SupplierProductPublic,
    dependencies=[require_permissions("cost.update")],
)
def update_supplier_product(
    *,
    session: SessionDep,
    supplier_id: uuid.UUID,
    product_id: uuid.UUID,
    supplier_product_in: SupplierProductUpdate,
) -> Any:
    """Update a supplier cost or its reference/default flags."""
    try:
        pair = crud.update_supplier_product(
            session=session,
            supplier_id=supplier_id,
            product_id=product_id,
            supplier_product_in=supplier_product_in,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return _decorate(session, [pair])[0]


@router.delete(
    "/{supplier_id}/{product_id}",
    response_model=Message,
    dependencies=[require_permissions("cost.update")],
)
def delete_supplier_product(
    session: SessionDep, supplier_id: uuid.UUID, product_id: uuid.UUID
) -> Any:
    """Unregister a supplier-product pair."""
    try:
        crud.delete_supplier_product(
            session=session, supplier_id=supplier_id, product_id=product_id
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return Message(message="Supplier-product pair deleted")
