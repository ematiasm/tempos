import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from sqlmodel import col, func, select

from app import crud
from app.api.deps import CurrentUser, PaginationDep, SessionDep, require_permissions
from app.models import (
    CashRegisterSession,
    CashSessionCloseCreate,
    CashSessionOpenCreate,
    CashSessionPublic,
    CashSessionReport,
    CashSessionStatus,
    Page,
)

router = APIRouter(prefix="/cash-sessions", tags=["cash-sessions"])


@router.get(
    "/current",
    response_model=CashSessionPublic | None,
    dependencies=[require_permissions("cash.read")],
)
def read_current_cash_session(session: SessionDep) -> Any:
    """The currently open cash session, or null when none is open."""
    open_session = crud._get_open_cash_session(session)  # noqa: SLF001
    if open_session is None:
        return None
    return crud._cash_session_public(session, open_session)  # noqa: SLF001


@router.post(
    "/open",
    response_model=CashSessionPublic,
    dependencies=[require_permissions("cash.open")],
)
def open_cash_session(
    *, session: SessionDep, current_user: CurrentUser, open_in: CashSessionOpenCreate
) -> Any:
    """Open a daily cash session with the initial float."""
    try:
        cash_session = crud.open_cash_session(
            session=session, open_in=open_in, user_id=current_user.id
        )
    except crud.BusinessError as e:
        session.rollback()
        raise HTTPException(
            status_code=400, detail={"code": e.code, "message": e.message}
        ) from e
    return crud._cash_session_public(session, cash_session)  # noqa: SLF001


@router.post(
    "/{cash_session_id}/close",
    response_model=CashSessionPublic,
    dependencies=[require_permissions("cash.close")],
)
def close_cash_session(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    cash_session_id: uuid.UUID,
    close_in: CashSessionCloseCreate,
) -> Any:
    """Close a cash session with the physical drawer count (arqueo)."""
    cash_session = session.get(CashRegisterSession, cash_session_id)
    if cash_session is None:
        raise HTTPException(status_code=404, detail="Cash session not found")
    try:
        crud.close_cash_session(
            session=session,
            cash_session=cash_session,
            close_in=close_in,
            user_id=current_user.id,
        )
    except crud.BusinessError as e:
        session.rollback()
        raise HTTPException(
            status_code=400, detail={"code": e.code, "message": e.message}
        ) from e
    return crud._cash_session_public(session, cash_session)  # noqa: SLF001


@router.get(
    "/",
    response_model=Page[CashSessionPublic],
    dependencies=[require_permissions("cash.read")],
)
def read_cash_sessions(
    session: SessionDep,
    pagination: PaginationDep,
    status: CashSessionStatus | None = Query(default=None),
) -> Any:
    """Paginated cash-session history, optionally filtered by status."""
    conditions = []
    if status is not None:
        conditions.append(col(CashRegisterSession.status) == status)
    count = session.exec(
        select(func.count()).select_from(CashRegisterSession).where(*conditions)
    ).one()
    sessions = session.exec(
        select(CashRegisterSession)
        .where(*conditions)
        .order_by(col(CashRegisterSession.opened_at).desc())
        .offset(pagination.skip)
        .limit(pagination.limit)
    ).all()
    return Page[CashSessionPublic](
        data=[crud._cash_session_public(session, s) for s in sessions],  # noqa: SLF001
        count=count,
    )


@router.get(
    "/{cash_session_id}/report",
    response_model=CashSessionReport,
    dependencies=[require_permissions("cash.read")],
)
def read_cash_session_report(session: SessionDep, cash_session_id: uuid.UUID) -> Any:
    """The full closing report for a cash session (computed live)."""
    cash_session = session.get(CashRegisterSession, cash_session_id)
    if cash_session is None:
        raise HTTPException(status_code=404, detail="Cash session not found")
    return crud.cash_session_report(session=session, cash_session=cash_session)
