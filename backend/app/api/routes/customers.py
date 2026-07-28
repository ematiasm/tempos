import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import col, func, select

from app.api.deps import PaginationDep, SessionDep, require_permissions
from app.models import (
    CONSUMIDOR_FINAL_NAME,
    Customer,
    CustomerCreate,
    CustomerPublic,
    CustomerUpdate,
    Message,
    Page,
)

router = APIRouter(prefix="/customers", tags=["customers"])


@router.get(
    "/",
    response_model=Page[CustomerPublic],
    dependencies=[require_permissions("customer.read")],
)
def read_customers(session: SessionDep, pagination: PaginationDep) -> Any:
    """Retrieve customers."""
    count = session.exec(select(func.count()).select_from(Customer)).one()
    customers = session.exec(
        select(Customer).offset(pagination.skip).limit(pagination.limit)
    ).all()
    return Page[CustomerPublic](
        data=[CustomerPublic.model_validate(c) for c in customers], count=count
    )


@router.get(
    "/{customer_id}",
    response_model=CustomerPublic,
    dependencies=[require_permissions("customer.read")],
)
def read_customer(session: SessionDep, customer_id: uuid.UUID) -> Any:
    """Get a specific customer by id."""
    customer = session.get(Customer, customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer


@router.post(
    "/",
    response_model=CustomerPublic,
    dependencies=[require_permissions("customer.create")],
)
def create_customer(*, session: SessionDep, customer_in: CustomerCreate) -> Any:
    """Create a new customer."""
    if customer_in.documento:
        existing = session.exec(
            select(Customer).where(col(Customer.documento) == customer_in.documento)
        ).first()
        if existing:
            raise HTTPException(
                status_code=400,
                detail="A customer with this document already exists",
            )
    customer = Customer.model_validate(customer_in)
    session.add(customer)
    session.commit()
    session.refresh(customer)
    return customer


@router.patch(
    "/{customer_id}",
    response_model=CustomerPublic,
    dependencies=[require_permissions("customer.update")],
)
def update_customer(
    *, session: SessionDep, customer_id: uuid.UUID, customer_in: CustomerUpdate
) -> Any:
    """Update a customer. The seeded 'Consumidor Final' cannot be deactivated."""
    customer = session.get(Customer, customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    data = customer_in.model_dump(exclude_unset=True)
    if data.get("documento"):
        existing = session.exec(
            select(Customer).where(
                col(Customer.documento) == data["documento"],
                col(Customer.id) != customer_id,
            )
        ).first()
        if existing:
            raise HTTPException(
                status_code=400,
                detail="A customer with this document already exists",
            )
    if (
        customer.razon_social == CONSUMIDOR_FINAL_NAME
        and data.get("is_active") is False
    ):
        raise HTTPException(
            status_code=400,
            detail="The 'Consumidor Final' customer cannot be deactivated",
        )
    customer.sqlmodel_update(data)
    session.add(customer)
    session.commit()
    session.refresh(customer)
    return customer


@router.delete(
    "/{customer_id}",
    response_model=Message,
    dependencies=[require_permissions("customer.delete")],
)
def delete_customer(session: SessionDep, customer_id: uuid.UUID) -> Any:
    """Deactivate a customer (soft delete).

    The seeded 'Consumidor Final' customer cannot be deleted.
    """
    customer = session.get(Customer, customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    if customer.razon_social == CONSUMIDOR_FINAL_NAME:
        raise HTTPException(
            status_code=400,
            detail="The 'Consumidor Final' customer cannot be deleted",
        )
    customer.is_active = False
    session.add(customer)
    session.commit()
    return Message(message="Customer deactivated successfully")
