import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlmodel import col, func, select

from app.api.deps import PaginationDep, SessionDep, require_permissions
from app.models import (
    Document,
    DocumentLine,
    DocumentLineTax,
    DocumentTax,
    DocumentType,
    Message,
    Page,
    Tax,
    TaxCreate,
    TaxPublic,
    TaxUpdate,
)

router = APIRouter(prefix="/taxes", tags=["taxes"])

# Fields that change fiscal amounts or historical labels; editing them is
# forbidden once the tax appears in any document.
_RESTRICTED_TAX_FIELDS = {"tipo", "rate", "is_percent", "aplica_a"}


@router.get(
    "/",
    response_model=Page[TaxPublic],
    dependencies=[require_permissions("product.read")],
)
def read_taxes(session: SessionDep, pagination: PaginationDep) -> Any:
    """Retrieve taxes."""
    count = session.exec(select(func.count()).select_from(Tax)).one()
    taxes = session.exec(
        select(Tax).offset(pagination.skip).limit(pagination.limit)
    ).all()
    return Page[TaxPublic](
        data=[TaxPublic.model_validate(t) for t in taxes], count=count
    )


@router.post(
    "/",
    response_model=TaxPublic,
    dependencies=[require_permissions("settings.update")],
)
def create_tax(*, session: SessionDep, tax_in: TaxCreate) -> Any:
    """Create a tax."""
    existing = session.exec(select(Tax).where(col(Tax.code) == tax_in.code)).first()
    if existing:
        raise HTTPException(
            status_code=400, detail="A tax with this code already exists"
        )
    tax = Tax.model_validate(tax_in)
    session.add(tax)
    session.commit()
    session.refresh(tax)
    return tax


@router.patch(
    "/{tax_id}",
    response_model=TaxPublic,
    dependencies=[require_permissions("settings.update")],
)
def update_tax(*, session: SessionDep, tax_id: uuid.UUID, tax_in: TaxUpdate) -> Any:
    """Update a tax.

    Taxes referenced by documents can only have their ``name``, ``code``,
    ``is_default`` or ``is_active`` edited; fiscal fields (``tipo``, ``rate``,
    ``is_percent``, ``aplica_a``) are frozen so historical amounts and report
    labels cannot change retroactively.
    """
    tax = session.get(Tax, tax_id)
    if not tax:
        raise HTTPException(status_code=404, detail="Tax not found")
    data = tax_in.model_dump(exclude_unset=True)
    if data.get("code"):
        existing = session.exec(
            select(Tax).where(col(Tax.code) == data["code"], col(Tax.id) != tax_id)
        ).first()
        if existing:
            raise HTTPException(
                status_code=400, detail="A tax with this code already exists"
            )
    restricted = set(data) & _RESTRICTED_TAX_FIELDS
    if restricted:
        documents = _tax_referencing_documents(session, tax)
        if documents:
            raise _tax_in_use_error(documents)
    tax.sqlmodel_update(data)
    session.add(tax)
    session.commit()
    session.refresh(tax)
    return tax


@router.delete(
    "/{tax_id}",
    response_model=Message,
    dependencies=[require_permissions("settings.update")],
)
def delete_tax(session: SessionDep, tax_id: uuid.UUID) -> Any:
    """Hard-delete a tax, unless it is referenced by any document.

    Taxes used in documents cannot be deleted to preserve traceability; the
    response carries the offending documents so the UI can show them. The
    database FKs on ``documentline_tax`` and ``document_tax`` act as a final
    safety net.
    """
    tax = session.get(Tax, tax_id)
    if not tax:
        raise HTTPException(status_code=404, detail="Tax not found")
    documents = _tax_referencing_documents(session, tax)
    if documents:
        raise _tax_in_use_error(documents)
    try:
        session.delete(tax)
        session.commit()
    except IntegrityError as e:
        session.rollback()
        raise _tax_in_use_error([]) from e
    return Message(message="Tax deleted successfully")


def _tax_referencing_documents(
    session: SessionDep, tax: Tax
) -> list[tuple[Document, str]]:
    """Return the distinct documents referencing ``tax`` (by id and type name)."""
    rows = list(
        session.exec(
            select(Document, DocumentType.name)
            .join(DocumentType, col(DocumentType.id) == Document.document_type_id)
            .join(DocumentTax, col(DocumentTax.document_id) == Document.id)
            .where(col(DocumentTax.tax_id) == tax.id)
            .distinct()
            .order_by(col(Document.fecha))
        ).all()
    )
    rows += list(
        session.exec(
            select(Document, DocumentType.name)
            .join(DocumentType, col(DocumentType.id) == Document.document_type_id)
            .join(DocumentLine, col(DocumentLine.document_id) == Document.id)
            .join(
                DocumentLineTax,
                col(DocumentLineTax.document_line_id) == DocumentLine.id,
            )
            .where(col(DocumentLineTax.tax_id) == tax.id)
            .distinct()
            .order_by(col(Document.fecha))
        ).all()
    )
    seen: set[uuid.UUID] = set()
    result: list[tuple[Document, str]] = []
    for document, type_name in rows:
        if document.id in seen:
            continue
        seen.add(document.id)
        result.append((document, type_name))
    return result


def _tax_in_use_error(
    documents: list[tuple[Document, str]],
) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={
            "code": "tax_in_use",
            "message": "Tax cannot be modified because it belongs to documents",
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
