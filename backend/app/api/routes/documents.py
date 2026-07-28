import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlalchemy.orm import selectinload
from sqlmodel import col, func, select

from app import crud
from app.api.deps import CurrentUser, PaginationDep, SessionDep, require_permissions
from app.core.db import FISCAL_SALE_TYPE_NAMES
from app.models import (
    BusinessSettings,
    CounterpartType,
    Customer,
    Document,
    DocumentCreate,
    DocumentLine,
    DocumentPublic,
    DocumentType,
    DocumentTypePublic,
    Page,
    Supplier,
    TaxCondition,
)

router = APIRouter(prefix="/documents", tags=["documents"])


def _document_query_options() -> tuple[Any, ...]:
    return (
        selectinload(Document.document_type),  # type: ignore
        selectinload(Document.lines).selectinload(DocumentLine.taxes),  # type: ignore
        selectinload(Document.taxes),  # type: ignore
        selectinload(Document.payments),  # type: ignore
    )


def _attach_counterpart_names(
    session: SessionDep, documents: list[Document]
) -> list[DocumentPublic]:
    """Resolve the polymorphic counterpart name with two bulk queries."""
    customer_ids = {
        d.contraparte_id
        for d in documents
        if d.contraparte_type == CounterpartType.CUSTOMER and d.contraparte_id
    }
    supplier_ids = {
        d.contraparte_id
        for d in documents
        if d.contraparte_type == CounterpartType.SUPPLIER and d.contraparte_id
    }
    names: dict[uuid.UUID, str] = {}
    if customer_ids:
        names.update(
            {
                c.id: c.razon_social
                for c in session.exec(
                    select(Customer).where(col(Customer.id).in_(customer_ids))
                ).all()
            }
        )
    if supplier_ids:
        names.update(
            {
                s.id: s.razon_social
                for s in session.exec(
                    select(Supplier).where(col(Supplier.id).in_(supplier_ids))
                ).all()
            }
        )
    publics = []
    for document in documents:
        public = DocumentPublic.model_validate(document)
        public.contraparte_name = (
            names.get(document.contraparte_id) if document.contraparte_id else None
        )
        publics.append(public)
    return publics


@router.get(
    "/suggest-type",
    response_model=DocumentTypePublic,
    dependencies=[require_permissions("document.read")],
)
def suggest_fiscal_sale_type(session: SessionDep, customer_id: uuid.UUID) -> Any:
    """Resolve Factura A/B/C from the business/customer tax condition combo.

    RI business + RI customer → A; RI business + anyone else → B;
    non-RI business → C. Matched by seeded type name.
    """
    customer = session.get(Customer, customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    settings = session.exec(select(BusinessSettings)).first()
    if not settings:
        raise HTTPException(status_code=404, detail="Business settings not found")
    business_is_ri = settings.condicion_fiscal == TaxCondition.RI
    customer_is_ri = customer.condicion_fiscal == TaxCondition.RI
    letter = (
        "A" if business_is_ri and customer_is_ri else "B" if business_is_ri else "C"
    )
    doc_type = session.exec(
        select(DocumentType).where(
            col(DocumentType.name) == FISCAL_SALE_TYPE_NAMES[letter]
        )
    ).first()
    if not doc_type:
        raise HTTPException(
            status_code=400,
            detail=f"Seeded document type '{FISCAL_SALE_TYPE_NAMES[letter]}' not found",
        )
    return doc_type


@router.get(
    "/",
    response_model=Page[DocumentPublic],
    dependencies=[require_permissions("document.read")],
)
def read_documents(session: SessionDep, pagination: PaginationDep) -> Any:
    """Retrieve documents with lines, taxes and payments."""
    count = session.exec(select(func.count()).select_from(Document)).one()
    documents = session.exec(
        select(Document)
        .options(*_document_query_options())
        .order_by(col(Document.created_at).desc())
        .offset(pagination.skip)
        .limit(pagination.limit)
    ).all()
    return Page[DocumentPublic](
        data=_attach_counterpart_names(session, list(documents)), count=count
    )


@router.get(
    "/{document_id}",
    response_model=DocumentPublic,
    dependencies=[require_permissions("document.read")],
)
def read_document(session: SessionDep, document_id: uuid.UUID) -> Any:
    """Get a specific document by id."""
    document = session.exec(
        select(Document)
        .where(col(Document.id) == document_id)
        .options(*_document_query_options())
    ).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    return _attach_counterpart_names(session, [document])[0]


@router.post(
    "/",
    response_model=DocumentPublic,
    dependencies=[require_permissions("document.create")],
)
def create_document(
    *, session: SessionDep, current_user: CurrentUser, document_in: DocumentCreate
) -> Any:
    """Create a document with its lines, taxes and payments."""
    try:
        document = crud.create_document(
            session=session, document_in=document_in, user_id=current_user.id
        )
    except ValueError as e:
        session.rollback()
        raise HTTPException(status_code=400, detail=str(e)) from e
    return _attach_counterpart_names(session, [document])[0]
