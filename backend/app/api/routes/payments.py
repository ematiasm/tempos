import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import col, select

from app import crud
from app.api.deps import CurrentUser, SessionDep, require_permissions
from app.api.routes.documents import (
    _attach_counterpart_names,
    _document_query_options,
)
from app.models import (
    CounterpartType,
    Customer,
    Document,
    DocumentPaymentAllocation,
    OutstandingDocumentPublic,
    Page,
    PaymentReceiptCreate,
    PaymentReceiptPublic,
    ReceiptAllocationPublic,
    Supplier,
)

router = APIRouter(prefix="/payments", tags=["payments"])


def _receipt_allocations(
    session: SessionDep, receipt_document_id: uuid.UUID
) -> list[ReceiptAllocationPublic]:
    """Documents settled by a receipt, oldest first (traceability)."""
    rows = session.exec(
        select(DocumentPaymentAllocation, Document)
        .join(Document, col(Document.id) == col(DocumentPaymentAllocation.document_id))
        .where(DocumentPaymentAllocation.receipt_document_id == receipt_document_id)
        .order_by(col(Document.fecha).asc(), col(Document.numero).asc())
    ).all()
    return [
        ReceiptAllocationPublic(
            document_id=allocation.document_id,
            numero=document.numero,
            fecha=document.fecha,
            monto=allocation.monto,
        )
        for allocation, document in rows
    ]


@router.get(
    "/outstanding",
    response_model=Page[OutstandingDocumentPublic],
    dependencies=[require_permissions("payment.read")],
)
def read_outstanding(
    session: SessionDep, contraparte_type: CounterpartType, contraparte_id: uuid.UUID
) -> Any:
    """Outstanding (unpaid) documents of a counterpart, oldest first."""
    counterpart: Customer | Supplier | None
    if contraparte_type == CounterpartType.CUSTOMER:
        counterpart = session.get(Customer, contraparte_id)
    else:
        counterpart = session.get(Supplier, contraparte_id)
    if counterpart is None:
        raise HTTPException(status_code=404, detail="Counterpart not found")
    rows = crud.outstanding_documents(
        session=session,
        contraparte_type=contraparte_type,
        contraparte_id=contraparte_id,
    )
    return Page[OutstandingDocumentPublic](
        data=[OutstandingDocumentPublic.model_validate(r) for r in rows],
        count=len(rows),
    )


@router.post(
    "/",
    response_model=PaymentReceiptPublic,
    dependencies=[require_permissions("payment.create")],
)
def create_payment_receipt(
    *, session: SessionDep, current_user: CurrentUser, receipt_in: PaymentReceiptCreate
) -> Any:
    """Register a standalone payment (receipt) against a counterpart.

    The total is allocated FIFO across the counterpart's outstanding
    documents; any excess stays as an on-account credit.
    """
    try:
        receipt = crud.create_receipt(
            session=session, receipt_in=receipt_in, user_id=current_user.id
        )
    except crud.BusinessError as e:
        session.rollback()
        raise HTTPException(
            status_code=400, detail={"code": e.code, "message": e.message}
        ) from e
    except ValueError as e:
        session.rollback()
        raise HTTPException(status_code=400, detail=str(e)) from e
    return PaymentReceiptPublic(
        document=_attach_counterpart_names(session, [receipt])[0],
        allocations=_receipt_allocations(session, receipt.id),
    )


@router.get(
    "/{receipt_document_id}/allocations",
    response_model=list[ReceiptAllocationPublic],
    dependencies=[require_permissions("payment.read")],
)
def read_receipt_allocations(
    session: SessionDep, receipt_document_id: uuid.UUID
) -> Any:
    """Documents settled by a receipt (traceability)."""
    receipt = session.exec(
        select(Document)
        .where(col(Document.id) == receipt_document_id)
        .options(*_document_query_options())
    ).first()
    if not receipt:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return _receipt_allocations(session, receipt_document_id)
