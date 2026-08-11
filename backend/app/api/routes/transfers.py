from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import col, func, select

from app import crud
from app.api.deps import CurrentUser, PaginationDep, SessionDep, require_permissions
from app.models import Page, Transfer, TransferCreate, TransferPublic

router = APIRouter(prefix="/transfers", tags=["transfers"])


@router.get(
    "/",
    response_model=Page[TransferPublic],
    dependencies=[require_permissions("finance.read")],
)
def read_transfers(session: SessionDep, pagination: PaginationDep) -> Any:
    """Retrieve internal transfers."""
    count = session.exec(select(func.count()).select_from(Transfer)).one()
    transfers = session.exec(
        select(Transfer)
        .order_by(col(Transfer.created_at).desc())
        .offset(pagination.skip)
        .limit(pagination.limit)
    ).all()
    return Page[TransferPublic](
        data=[TransferPublic.model_validate(t) for t in transfers], count=count
    )


@router.post(
    "/",
    response_model=TransferPublic,
    dependencies=[require_permissions("transfer.create")],
)
def create_transfer(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    transfer_in: TransferCreate,
) -> Any:
    """Create an internal transfer with movements on both accounts (atomic)."""
    try:
        transfer = crud.create_transfer(
            session=session,
            transfer_in=transfer_in,
            user_id=current_user.id,
        )
    except ValueError as e:
        session.rollback()
        raise HTTPException(status_code=400, detail=str(e)) from e
    return transfer
