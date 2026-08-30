import uuid
from datetime import date
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from sqlmodel import col, func, select

from app import crud
from app.api.deps import PaginationDep, SessionDep, require_permissions
from app.models import (
    AccountMovement,
    AccountMovementPublic,
    CounterpartType,
    Customer,
    Document,
    FinancialAccount,
    Page,
    PaymentMethod,
    Supplier,
)

router = APIRouter(prefix="/account-movements", tags=["account-movements"])


def _decorate(
    session: SessionDep, movements: list[AccountMovement]
) -> list[AccountMovementPublic]:
    """Resolve display names with bulk queries.

    Accounts, payment methods and document numbers come straight from their
    tables; the counterpart name is resolved through each movement's document
    (``contraparte_type``/``contraparte_id`` → Customer/Supplier
    ``razon_social``).
    """
    account_ids = {m.financial_account_id for m in movements}
    document_ids = {m.document_id for m in movements if m.document_id}
    payment_method_ids = {m.payment_method_id for m in movements if m.payment_method_id}
    account_names = {
        a.id: a.name
        for a in session.exec(
            select(FinancialAccount).where(col(FinancialAccount.id).in_(account_ids))
        ).all()
    }
    method_names = {
        pm.id: pm.name
        for pm in session.exec(
            select(PaymentMethod).where(col(PaymentMethod.id).in_(payment_method_ids))
        ).all()
    }
    docs = {
        d.id: d
        for d in session.exec(
            select(Document).where(col(Document.id).in_(document_ids))
        ).all()
    }
    numbers = {d.id: d.numero for d in docs.values()}
    customer_ids = {
        d.contraparte_id
        for d in docs.values()
        if d.contraparte_type == CounterpartType.CUSTOMER and d.contraparte_id
    }
    supplier_ids = {
        d.contraparte_id
        for d in docs.values()
        if d.contraparte_type == CounterpartType.SUPPLIER and d.contraparte_id
    }
    customer_names = {
        c.id: c.razon_social
        for c in session.exec(
            select(Customer).where(col(Customer.id).in_(customer_ids))
        ).all()
    }
    supplier_names = {
        s.id: s.razon_social
        for s in session.exec(
            select(Supplier).where(col(Supplier.id).in_(supplier_ids))
        ).all()
    }
    publics = []
    for movement in movements:
        public = AccountMovementPublic.model_validate(movement)
        public.account_name = account_names.get(movement.financial_account_id)
        public.payment_method_name = (
            method_names.get(movement.payment_method_id)
            if movement.payment_method_id
            else None
        )
        public.document_numero = (
            numbers.get(movement.document_id) if movement.document_id else None
        )
        counterpart_name = None
        doc = docs.get(movement.document_id) if movement.document_id else None
        if doc is not None and doc.contraparte_id is not None:
            if doc.contraparte_type == CounterpartType.CUSTOMER:
                counterpart_name = customer_names.get(doc.contraparte_id)
            elif doc.contraparte_type == CounterpartType.SUPPLIER:
                counterpart_name = supplier_names.get(doc.contraparte_id)
        public.counterpart_name = counterpart_name
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
    fecha_desde: date | None = Query(default=None),
    fecha_hasta: date | None = Query(default=None),
) -> Any:
    """Retrieve account movements (append-only ledger), optionally filtered.

    ``fecha_desde``/``fecha_hasta`` are inclusive business-local days resolved
    against ``AccountMovement.fecha``.
    """
    conditions = []
    if financial_account_id:
        conditions.append(
            col(AccountMovement.financial_account_id) == financial_account_id
        )
    if conciliado is not None:
        conditions.append(col(AccountMovement.conciliado) == conciliado)
    dt_from, dt_to = crud.period_bounds(session, fecha_desde, fecha_hasta)
    if dt_from is not None:
        conditions.append(col(AccountMovement.fecha) >= dt_from)
    if dt_to is not None:
        conditions.append(col(AccountMovement.fecha) <= dt_to)
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
