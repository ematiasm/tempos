import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from sqlmodel import col, func, select

from app.api.deps import PaginationDep, SessionDep, require_permissions
from app.models import (
    AccountMovement,
    AccountMovementPublic,
    Document,
    FinancialAccount,
    Page,
)

router = APIRouter(prefix="/account-movements", tags=["account-movements"])


def _decorate(
    session: SessionDep, movements: list[AccountMovement]
) -> list[AccountMovementPublic]:
    """Resolve account names and document numbers with two bulk queries."""
    account_ids = {m.financial_account_id for m in movements}
    document_ids = {m.document_id for m in movements if m.document_id}
    account_names = {
        a.id: a.name
        for a in session.exec(
            select(FinancialAccount).where(col(FinancialAccount.id).in_(account_ids))
        ).all()
    }
    numbers = {
        d.id: d.numero
        for d in session.exec(
            select(Document).where(col(Document.id).in_(document_ids))
        ).all()
    }
    publics = []
    for movement in movements:
        public = AccountMovementPublic.model_validate(movement)
        public.account_name = account_names.get(movement.financial_account_id)
        public.document_numero = (
            numbers.get(movement.document_id) if movement.document_id else None
        )
        publics.append(public)
    return publics


@router.get(
    "/",
    response_model=Page[AccountMovementPublic],
    dependencies=[require_permissions("finance.read")],
)
def read_account_movements(
    session: SessionDep,
    pagination: PaginationDep,
    financial_account_id: uuid.UUID | None = Query(default=None),
    conciliado: bool | None = Query(default=None),
    fecha_desde: datetime | None = Query(default=None),
    fecha_hasta: datetime | None = Query(default=None),
) -> Any:
    """Retrieve account movements (append-only ledger), optionally filtered."""
    conditions = []
    if financial_account_id:
        conditions.append(
            col(AccountMovement.financial_account_id) == financial_account_id
        )
    if conciliado is not None:
        conditions.append(col(AccountMovement.conciliado) == conciliado)
    if fecha_desde is not None:
        conditions.append(col(AccountMovement.fecha) >= fecha_desde)
    if fecha_hasta is not None:
        conditions.append(col(AccountMovement.fecha) <= fecha_hasta)
    count_stmt = select(func.count()).select_from(AccountMovement)
    if conditions:
        count_stmt = count_stmt.where(*conditions)
    count = session.exec(count_stmt).one()
    movements = session.exec(
        select(AccountMovement)
        .where(*conditions)
        .order_by(col(AccountMovement.fecha).desc())
        .offset(pagination.skip)
        .limit(pagination.limit)
    ).all()
    return Page[AccountMovementPublic](
        data=_decorate(session, list(movements)), count=count
    )


@router.post(
    "/{movement_id}/conciliate",
    response_model=AccountMovementPublic,
    dependencies=[require_permissions("finance.update")],
)
def conciliate_movement(*, session: SessionDep, movement_id: uuid.UUID) -> Any:
    """Mark an account movement as conciliated.

    Only the conciliation flag is touched; the ledger amount and direction
    remain immutable.
    """
    movement = session.get(AccountMovement, movement_id)
    if not movement:
        raise HTTPException(status_code=404, detail="Account movement not found")
    movement.conciliado = True
    session.add(movement)
    session.commit()
    session.refresh(movement)
    return _decorate(session, [movement])[0]
