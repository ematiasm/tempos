import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import col, func, select

from app.api.deps import PaginationDep, SessionDep, require_permissions
from app.models import (
    DocumentPayment,
    FinancialAccount,
    Message,
    Page,
    PaymentMethod,
    PaymentMethodCreate,
    PaymentMethodPublic,
    PaymentMethodUpdate,
)

router = APIRouter(prefix="/payment-methods", tags=["payment-methods"])


@router.get(
    "/",
    response_model=Page[PaymentMethodPublic],
    dependencies=[require_permissions("finance.read")],
)
def read_payment_methods(session: SessionDep, pagination: PaginationDep) -> Any:
    """Retrieve payment methods."""
    count = session.exec(select(func.count()).select_from(PaymentMethod)).one()
    payment_methods = session.exec(
        select(PaymentMethod).offset(pagination.skip).limit(pagination.limit)
    ).all()
    return Page[PaymentMethodPublic](
        data=[PaymentMethodPublic.model_validate(pm) for pm in payment_methods],
        count=count,
    )


@router.get(
    "/{payment_method_id}",
    response_model=PaymentMethodPublic,
    dependencies=[require_permissions("finance.read")],
)
def read_payment_method(session: SessionDep, payment_method_id: uuid.UUID) -> Any:
    """Get a specific payment method by id."""
    payment_method = session.get(PaymentMethod, payment_method_id)
    if not payment_method:
        raise HTTPException(status_code=404, detail="Payment method not found")
    return payment_method


@router.post(
    "/",
    response_model=PaymentMethodPublic,
    dependencies=[require_permissions("finance.create")],
)
def create_payment_method(
    *, session: SessionDep, payment_method_in: PaymentMethodCreate
) -> Any:
    """Create a new payment method linked to a financial account."""
    account = session.get(FinancialAccount, payment_method_in.financial_account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Financial account not found")
    payment_method = PaymentMethod.model_validate(payment_method_in)
    session.add(payment_method)
    session.commit()
    session.refresh(payment_method)
    return payment_method


@router.patch(
    "/{payment_method_id}",
    response_model=PaymentMethodPublic,
    dependencies=[require_permissions("finance.update")],
)
def update_payment_method(
    *,
    session: SessionDep,
    payment_method_id: uuid.UUID,
    payment_method_in: PaymentMethodUpdate,
) -> Any:
    """Update a payment method."""
    payment_method = session.get(PaymentMethod, payment_method_id)
    if not payment_method:
        raise HTTPException(status_code=404, detail="Payment method not found")
    data = payment_method_in.model_dump(exclude_unset=True)
    if data.get("financial_account_id"):
        account = session.get(FinancialAccount, data["financial_account_id"])
        if not account:
            raise HTTPException(status_code=404, detail="Financial account not found")
    payment_method.sqlmodel_update(data)
    session.add(payment_method)
    session.commit()
    session.refresh(payment_method)
    return payment_method


@router.delete(
    "/{payment_method_id}",
    response_model=Message,
    dependencies=[require_permissions("finance.update")],
)
def delete_payment_method(session: SessionDep, payment_method_id: uuid.UUID) -> Any:
    """Delete a payment method.

    Methods referenced by any document payment or account movement cannot be
    deleted because the finance ledger is append-only.
    """
    payment_method = session.get(PaymentMethod, payment_method_id)
    if not payment_method:
        raise HTTPException(status_code=404, detail="Payment method not found")
    referenced = session.exec(
        select(DocumentPayment).where(
            col(DocumentPayment.payment_method_id) == payment_method_id
        )
    ).first()
    if referenced:
        raise HTTPException(
            status_code=400,
            detail="This payment method is used by documents and cannot be deleted",
        )
    session.delete(payment_method)
    session.commit()
    return Message(message="Payment method deleted")
