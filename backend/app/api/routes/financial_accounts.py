import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import col, func, select

from app.api.deps import PaginationDep, SessionDep, require_permissions
from app.models import (
    AccountMovement,
    FinancialAccount,
    FinancialAccountCreate,
    FinancialAccountPublic,
    FinancialAccountUpdate,
    Message,
    Page,
    PaymentMethod,
)

router = APIRouter(prefix="/financial-accounts", tags=["financial-accounts"])


@router.get(
    "/",
    response_model=Page[FinancialAccountPublic],
    dependencies=[require_permissions("finance.read")],
)
def read_financial_accounts(session: SessionDep, pagination: PaginationDep) -> Any:
    """Retrieve financial accounts."""
    count = session.exec(select(func.count()).select_from(FinancialAccount)).one()
    accounts = session.exec(
        select(FinancialAccount)
        .order_by(col(FinancialAccount.name))
        .offset(pagination.skip)
        .limit(pagination.limit)
    ).all()
    return Page[FinancialAccountPublic](
        data=[FinancialAccountPublic.model_validate(a) for a in accounts], count=count
    )


@router.get(
    "/{account_id}",
    response_model=FinancialAccountPublic,
    dependencies=[require_permissions("finance.read")],
)
def read_financial_account(session: SessionDep, account_id: uuid.UUID) -> Any:
    """Get a specific financial account by id."""
    account = session.get(FinancialAccount, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Financial account not found")
    return account


@router.post(
    "/",
    response_model=FinancialAccountPublic,
    dependencies=[require_permissions("finance.create")],
)
def create_financial_account(
    *, session: SessionDep, account_in: FinancialAccountCreate
) -> Any:
    """Create a new financial account."""
    account = FinancialAccount.model_validate(account_in)
    session.add(account)
    session.commit()
    session.refresh(account)
    return account


@router.patch(
    "/{account_id}",
    response_model=FinancialAccountPublic,
    dependencies=[require_permissions("finance.update")],
)
def update_financial_account(
    *,
    session: SessionDep,
    account_id: uuid.UUID,
    account_in: FinancialAccountUpdate,
) -> Any:
    """Update a financial account (the saldo is never edited directly)."""
    account = session.get(FinancialAccount, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Financial account not found")
    account.sqlmodel_update(account_in.model_dump(exclude_unset=True))
    session.add(account)
    session.commit()
    session.refresh(account)
    return account


@router.delete(
    "/{account_id}",
    response_model=Message,
    dependencies=[require_permissions("finance.update")],
)
def delete_financial_account(session: SessionDep, account_id: uuid.UUID) -> Any:
    """Delete a financial account.

    Accounts referenced by a payment method or by ledger movements cannot be
    deleted because the finance ledger is append-only.
    """
    account = session.get(FinancialAccount, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Financial account not found")
    referenced = session.exec(
        select(PaymentMethod).where(
            col(PaymentMethod.financial_account_id) == account_id
        )
    ).first()
    if referenced:
        raise HTTPException(
            status_code=400,
            detail="This account is used by payment methods and cannot be deleted",
        )
    movement = session.exec(
        select(AccountMovement).where(
            col(AccountMovement.financial_account_id) == account_id
        )
    ).first()
    if movement:
        raise HTTPException(
            status_code=400,
            detail="This account has ledger movements and cannot be deleted",
        )
    session.delete(account)
    session.commit()
    return Message(message="Financial account deleted")
