import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import col, func, select

from app.api.deps import (
    PaginationDep,
    SessionDep,
    get_current_user,
    require_permissions,
)
from app.models import (
    DocumentType,
    DocumentTypePublic,
    DocumentTypeUpdate,
    Page,
)

router = APIRouter(prefix="/document-types", tags=["document-types"])


@router.get(
    "/",
    response_model=Page[DocumentTypePublic],
    # Authentication only: reference data needed by the sell screen.
    dependencies=[Depends(get_current_user)],
)
def read_document_types(session: SessionDep, pagination: PaginationDep) -> Any:
    """Retrieve document types."""
    count = session.exec(select(func.count()).select_from(DocumentType)).one()
    document_types = session.exec(
        select(DocumentType).offset(pagination.skip).limit(pagination.limit)
    ).all()
    return Page[DocumentTypePublic](
        data=[DocumentTypePublic.model_validate(dt) for dt in document_types],
        count=count,
    )


@router.patch(
    "/{document_type_id}",
    response_model=DocumentTypePublic,
    dependencies=[require_permissions("settings.update")],
)
def update_document_type(
    *,
    session: SessionDep,
    document_type_id: uuid.UUID,
    document_type_in: DocumentTypeUpdate,
) -> Any:
    """Update the editable fields of a document type (name, prefix, active).

    The key, the operation and the signs are seed-managed and cannot be changed;
    `key` is rejected explicitly because it is the identity code resolves a seeded
    type by, while `name` and `prefix` are free to be renamed.
    """
    document_type = session.get(DocumentType, document_type_id)
    if not document_type:
        raise HTTPException(status_code=404, detail="Document type not found")
    data = document_type_in.model_dump(exclude_unset=True)
    if "key" in data:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "document_type_key_immutable",
                "message": "The document type key cannot be changed",
            },
        )
    if data.get("prefix"):
        existing = session.exec(
            select(DocumentType).where(
                col(DocumentType.prefix) == data["prefix"],
                col(DocumentType.id) != document_type_id,
            )
        ).first()
        if existing:
            raise HTTPException(
                status_code=400,
                detail="A document type with this prefix already exists",
            )
    document_type.sqlmodel_update(data)
    session.add(document_type)
    session.commit()
    session.refresh(document_type)
    return document_type
