import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Query
from sqlmodel import col, func, select

from app.api.deps import PaginationDep, SessionDep, require_permissions
from app.models import (
    Document,
    Page,
    Product,
    StockMovement,
    StockMovementPublic,
)

router = APIRouter(prefix="/stock-movements", tags=["stock-movements"])


def _decorate(
    session: SessionDep, movements: list[StockMovement]
) -> list[StockMovementPublic]:
    """Resolve product names and document numbers with two bulk queries."""
    product_ids = {m.product_id for m in movements}
    document_ids = {m.document_id for m in movements}
    product_names = {
        p.id: p.name
        for p in session.exec(
            select(Product).where(col(Product.id).in_(product_ids))
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
        public = StockMovementPublic.model_validate(movement)
        public.product_name = product_names.get(movement.product_id)
        public.document_numero = numbers.get(movement.document_id)
        publics.append(public)
    return publics


@router.get(
    "/",
    response_model=Page[StockMovementPublic],
    dependencies=[require_permissions("stock.read")],
)
def read_stock_movements(
    session: SessionDep,
    pagination: PaginationDep,
    product_id: uuid.UUID | None = Query(default=None),
    document_id: uuid.UUID | None = Query(default=None),
    fecha_desde: datetime | None = Query(default=None),
    fecha_hasta: datetime | None = Query(default=None),
) -> Any:
    """Retrieve stock movements (append-only ledger), optionally filtered."""
    conditions = []
    if product_id:
        conditions.append(col(StockMovement.product_id) == product_id)
    if document_id:
        conditions.append(col(StockMovement.document_id) == document_id)
    if fecha_desde is not None:
        conditions.append(col(StockMovement.created_at) >= fecha_desde)
    if fecha_hasta is not None:
        conditions.append(col(StockMovement.created_at) <= fecha_hasta)
    count_stmt = select(func.count()).select_from(StockMovement)
    if conditions:
        count_stmt = count_stmt.where(*conditions)
    count = session.exec(count_stmt).one()
    movements = session.exec(
        select(StockMovement)
        .where(*conditions)
        .order_by(col(StockMovement.created_at).desc())
        .offset(pagination.skip)
        .limit(pagination.limit)
    ).all()
    return Page[StockMovementPublic](
        data=_decorate(session, list(movements)), count=count
    )
