import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlmodel import col, func, select

from app import crud
from app.api.deps import PaginationDep, SessionDep, require_permissions
from app.models import (
    CounterpartType,
    Document,
    Message,
    Page,
    Supplier,
    SupplierAccountMovement,
    SupplierAccountMovementPublic,
    SupplierCreate,
    SupplierPublic,
    SupplierUpdate,
)

router = APIRouter(prefix="/suppliers", tags=["suppliers"])


@router.get(
    "/",
    response_model=Page[SupplierPublic],
    dependencies=[require_permissions("supplier.read")],
)
def read_suppliers(session: SessionDep, pagination: PaginationDep) -> Any:
    """Retrieve suppliers."""
    count = session.exec(select(func.count()).select_from(Supplier)).one()
    suppliers = session.exec(
        select(Supplier).offset(pagination.skip).limit(pagination.limit)
    ).all()
    return Page[SupplierPublic](
        data=[SupplierPublic.model_validate(s) for s in suppliers], count=count
    )


@router.get(
    "/{supplier_id}",
    response_model=SupplierPublic,
    dependencies=[require_permissions("supplier.read")],
)
def read_supplier(session: SessionDep, supplier_id: uuid.UUID) -> Any:
    """Get a specific supplier by id."""
    supplier = session.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return supplier


@router.post(
    "/",
    response_model=SupplierPublic,
    dependencies=[require_permissions("supplier.create")],
)
def create_supplier(*, session: SessionDep, supplier_in: SupplierCreate) -> Any:
    """Create a new supplier."""
    if supplier_in.documento:
        existing = session.exec(
            select(Supplier).where(col(Supplier.documento) == supplier_in.documento)
        ).first()
        if existing:
            raise HTTPException(
                status_code=400,
                detail="A supplier with this document already exists",
            )
    supplier = Supplier.model_validate(supplier_in)
    session.add(supplier)
    session.commit()
    session.refresh(supplier)
    return supplier


@router.patch(
    "/{supplier_id}",
    response_model=SupplierPublic,
    dependencies=[require_permissions("supplier.update")],
)
def update_supplier(
    *, session: SessionDep, supplier_id: uuid.UUID, supplier_in: SupplierUpdate
) -> Any:
    """Update a supplier."""
    supplier = session.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    data = supplier_in.model_dump(exclude_unset=True)
    if data.get("documento"):
        existing = session.exec(
            select(Supplier).where(
                col(Supplier.documento) == data["documento"],
                col(Supplier.id) != supplier_id,
            )
        ).first()
        if existing:
            raise HTTPException(
                status_code=400,
                detail="A supplier with this document already exists",
            )
    supplier.sqlmodel_update(data)
    session.add(supplier)
    session.commit()
    session.refresh(supplier)
    return supplier


@router.delete(
    "/{supplier_id}",
    response_model=Message,
    dependencies=[require_permissions("supplier.delete")],
)
def delete_supplier(session: SessionDep, supplier_id: uuid.UUID) -> Any:
    """Hard-delete a supplier, unless referenced by documents.

    Suppliers with documents (or current-account movements) cannot be deleted
    to preserve traceability; the response carries the offending documents so
    the UI can show them. Deactivation stays available via ``PATCH``
    ``is_active``.
    """
    supplier = session.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    rows = crud.documents_for_counterpart(
        session, CounterpartType.SUPPLIER, supplier.id
    )
    if rows:
        raise _supplier_in_use_error(rows)
    try:
        session.delete(supplier)
        session.commit()
    except IntegrityError as e:
        session.rollback()
        raise _supplier_in_use_error([]) from e
    return Message(message="Supplier deleted successfully")


def _supplier_in_use_error(
    documents: list[tuple[Document, str]],
) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={
            "code": "supplier_in_use",
            "message": "Supplier cannot be deleted because it belongs to documents",
            "documents": [
                {
                    "id": str(document.id),
                    "numero": document.numero,
                    "fecha": document.fecha.isoformat(),
                    "total": str(document.total),
                    "estado": document.estado.value,
                    "type_name": type_name,
                }
                for document, type_name in documents
            ],
        },
    )


@router.get(
    "/{supplier_id}/account-movements",
    response_model=Page[SupplierAccountMovementPublic],
    dependencies=[require_permissions("supplier.read")],
)
def read_supplier_account_movements(
    session: SessionDep, supplier_id: uuid.UUID, pagination: PaginationDep
) -> Any:
    """Retrieve the supplier's current-account ledger (append-only)."""
    supplier = session.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    conditions = [col(SupplierAccountMovement.supplier_id) == supplier_id]
    count = session.exec(
        select(func.count()).select_from(SupplierAccountMovement).where(*conditions)
    ).one()
    movements = session.exec(
        select(SupplierAccountMovement)
        .where(*conditions)
        .order_by(col(SupplierAccountMovement.created_at).desc())
        .offset(pagination.skip)
        .limit(pagination.limit)
    ).all()
    document_ids = {m.document_id for m in movements if m.document_id}
    numbers = {
        d.id: d.numero
        for d in session.exec(
            select(Document).where(col(Document.id).in_(document_ids))
        ).all()
    }
    publics = []
    for movement in movements:
        public = SupplierAccountMovementPublic.model_validate(movement)
        public.document_numero = (
            numbers.get(movement.document_id) if movement.document_id else None
        )
        publics.append(public)
    return Page[SupplierAccountMovementPublic](data=publics, count=count)
