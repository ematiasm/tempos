from typing import Any

from fastapi import APIRouter
from sqlmodel import func, select

from app.api.deps import PaginationDep, SessionDep, require_permissions
from app.models import Page, PaymentMethod, PaymentMethodPublic

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
