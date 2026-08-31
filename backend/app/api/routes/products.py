import uuid
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import case
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload
from sqlmodel import col, func, or_, select

from app import crud
from app.api.deps import PaginationDep, SessionDep, require_permissions
from app.models import (
    AttributeValue,
    Barcode,
    BarcodeCreate,
    Category,
    Document,
    DocumentLine,
    DocumentType,
    Message,
    Page,
    Product,
    ProductCategoryCountPublic,
    ProductCategoryCountsPublic,
    ProductCreate,
    ProductListItemPublic,
    ProductPublic,
    ProductUpdate,
    ProductVariant,
    ProductVariantAttribute,
    ProductVariantCreate,
    ProductVariantPublic,
    UoM,
)

router = APIRouter(prefix="/products", tags=["products"])


def _ensure_stock_maximo(minimo: Decimal | None, maximo: Decimal) -> None:
    """The maximum is permanent and must not fall below the minimum."""
    if minimo is not None and maximo < minimo:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "stock_maximo_below_minimo",
                "message": "stock_maximo cannot be lower than stock_minimo",
            },
        )


@router.get(
    "/",
    response_model=Page[ProductListItemPublic],
    dependencies=[require_permissions("product.read")],
)
def read_products(
    session: SessionDep,
    pagination: PaginationDep,
    q: str | None = Query(default=None, max_length=100),
    category_id: uuid.UUID | None = Query(default=None),
) -> Any:
    """Retrieve products (light rows, server-side pagination).

    ``q`` matches name, SKU or barcode (case-insensitive) and includes
    inactive products; ``category_id`` filters by exact category. Results are
    ordered by name so pagination windows are deterministic regardless of the
    catalog size.
    """
    filters: list[Any] = []
    if q:
        term = f"%{q.strip()}%"
        filters.append(
            or_(
                col(Product.name).ilike(term),
                col(Product.sku).ilike(term),
                col(Product.id).in_(
                    select(col(Barcode.product_id)).where(col(Barcode.code).ilike(term))
                ),
            )
        )
    if category_id is not None:
        filters.append(col(Product.category_id) == category_id)
    count = session.exec(
        select(func.count()).select_from(Product).where(*filters)
    ).one()
    products = session.exec(
        select(Product)
        .where(*filters)
        .options(selectinload(Product.taxes))  # type: ignore
        .order_by(col(Product.name))
        .offset(pagination.skip)
        .limit(pagination.limit)
    ).all()
    return Page[ProductListItemPublic](
        data=[ProductListItemPublic.model_validate(p) for p in products],
        count=count,
    )


@router.get(
    "/counts-by-category",
    response_model=ProductCategoryCountsPublic,
    dependencies=[require_permissions("product.read")],
)
def read_product_category_counts(session: SessionDep) -> Any:
    """Aggregate product counts per category (None = uncategorized)."""
    total = session.exec(select(func.count()).select_from(Product)).one()
    rows = session.exec(
        select(Product.category_id, func.count())
        .group_by(col(Product.category_id))
        .order_by(col(Product.category_id))
    ).all()
    return ProductCategoryCountsPublic(
        total=total,
        by_category=[
            ProductCategoryCountPublic(category_id=category_id, count=count)
            for category_id, count in rows
        ],
    )


@router.get(
    "/search",
    response_model=Page[ProductPublic],
    dependencies=[require_permissions("product.read")],
)
def search_products(
    session: SessionDep,
    q: str = Query(min_length=1, max_length=100),
    limit: int = Query(default=25, ge=1, le=100),
) -> Any:
    """Search active products by name, SKU or barcode (case-insensitive).

    Results are ranked in three tiers: exact barcode match first (product- or
    variant-level codes), then exact name match, then partial matches; within
    each tier products are ordered by name. Meant for the point-of-sale
    lookup where the typing is live and the result set is small.
    """
    term = f"%{q.strip()}%"
    exact = q.strip()
    # SQL CASE tiering (not post-LIMIT Python re-ranking): an exact match
    # buried beyond the limit window must still win. Barcode rows carry
    # product_id for variant barcodes too, so one subquery covers both.
    barcode_tier = col(Product.id).in_(
        select(col(Barcode.product_id)).where(col(Barcode.code).ilike(exact))
    )
    match_tier = case(
        (barcode_tier, 0),
        (col(Product.name).ilike(exact), 1),
        else_=2,
    )
    products = session.exec(
        select(Product)
        .where(Product.is_active)
        .where(
            or_(
                col(Product.name).ilike(term),
                col(Product.sku).ilike(term),
                col(Product.id).in_(
                    select(col(Barcode.product_id)).where(col(Barcode.code).ilike(term))
                ),
            )
        )
        .options(
            selectinload(Product.taxes),  # type: ignore
            selectinload(Product.barcodes),  # type: ignore
            selectinload(Product.uom),  # type: ignore
            selectinload(Product.variants).selectinload(  # type: ignore
                ProductVariant.barcodes  # type: ignore
            ),
            selectinload(Product.variants).selectinload(  # type: ignore
                ProductVariant.attribute_values  # type: ignore
            ),
        )
        .order_by(match_tier, col(Product.name))
        .limit(limit)
    ).all()
    return Page[ProductPublic](
        data=[ProductPublic.model_validate(p) for p in products],
        count=len(products),
    )


@router.get(
    "/{product_id}",
    response_model=ProductPublic,
    dependencies=[require_permissions("product.read")],
)
def read_product(session: SessionDep, product_id: uuid.UUID) -> Any:
    """Get a specific product by id."""
    product = session.exec(
        select(Product)
        .where(col(Product.id) == product_id)
        .options(
            selectinload(Product.taxes),  # type: ignore
            selectinload(Product.barcodes),  # type: ignore
            selectinload(Product.variants).selectinload(  # type: ignore
                ProductVariant.barcodes  # type: ignore
            ),
            selectinload(Product.variants).selectinload(  # type: ignore
                ProductVariant.attribute_values  # type: ignore
            ),
        )
    ).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


@router.post(
    "/",
    response_model=ProductPublic,
    dependencies=[require_permissions("product.create")],
)
def create_product(*, session: SessionDep, product_in: ProductCreate) -> Any:
    """Create a new product."""
    if product_in.sku:
        existing = session.exec(
            select(Product).where(col(Product.sku) == product_in.sku)
        ).first()
        if existing:
            raise HTTPException(
                status_code=400, detail="A product with this SKU already exists"
            )
    if not session.get(UoM, product_in.uom_id):
        raise HTTPException(status_code=400, detail="Unit of measure not found")
    if product_in.category_id and not session.get(Category, product_in.category_id):
        raise HTTPException(status_code=400, detail="Category not found")
    # stock_maximo is permanent: an absent value auto-fills with the minimum
    # (order-up-to-min semantics) or with 0 when there is no minimum either.
    if "stock_maximo" in product_in.model_fields_set:
        maximo = product_in.stock_maximo
    else:
        maximo = (
            product_in.stock_minimo
            if product_in.stock_minimo is not None
            else Decimal("0")
        )
    _ensure_stock_maximo(product_in.stock_minimo, maximo)
    product_in.stock_maximo = maximo
    product = crud.create_product(session=session, product_in=product_in)
    return product


@router.patch(
    "/{product_id}",
    response_model=ProductPublic,
    dependencies=[require_permissions("product.update")],
)
def update_product(
    *, session: SessionDep, product_id: uuid.UUID, product_in: ProductUpdate
) -> Any:
    """Update a product."""
    product = session.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    data = product_in.model_dump(exclude_unset=True)
    if data.get("sku"):
        existing = session.exec(
            select(Product).where(
                col(Product.sku) == data["sku"], col(Product.id) != product_id
            )
        ).first()
        if existing:
            raise HTTPException(
                status_code=400, detail="A product with this SKU already exists"
            )
    if data.get("uom_id") and not session.get(UoM, data["uom_id"]):
        raise HTTPException(status_code=400, detail="Unit of measure not found")
    if data.get("category_id") and not session.get(Category, data["category_id"]):
        raise HTTPException(status_code=400, detail="Category not found")
    # stock_maximo is permanent: an explicit null (legacy "clear it") keeps
    # the current value, an absent one leaves the row untouched, and the
    # effective pair must not end up with maximo below minimo (the DB CHECK
    # constraint is the final net).
    if "stock_maximo" in data and data["stock_maximo"] is None:
        product_in.stock_maximo = product.stock_maximo
    effective_minimo = (
        product_in.stock_minimo if "stock_minimo" in data else product.stock_minimo
    )
    effective_maximo = (
        product_in.stock_maximo if "stock_maximo" in data else product.stock_maximo
    )
    if effective_maximo is not None:
        _ensure_stock_maximo(effective_minimo, effective_maximo)
    product = crud.update_product(
        session=session, db_product=product, product_in=product_in
    )
    return product


@router.delete(
    "/{product_id}",
    response_model=Message,
    dependencies=[require_permissions("product.delete")],
)
def delete_product(session: SessionDep, product_id: uuid.UUID) -> Any:
    """Hard-delete a product, unless it is referenced by any document.

    Products referenced by documents (sales, purchases, quotes, etc.) cannot
    be deleted to preserve traceability; the response carries the offending
    documents so the UI can show them. The database FKs on ``documentline``
    and ``stockmovement`` act as a final safety net.
    """
    product = session.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    _ensure_product_deletable(session, product)
    try:
        session.delete(product)
        session.commit()
    except IntegrityError as e:
        session.rollback()
        raise HTTPException(
            status_code=409,
            detail={
                "code": "product_in_use",
                "message": (
                    "Product cannot be deleted because it is referenced by "
                    "documents or stock movements"
                ),
                "documents": [],
            },
        ) from e
    return Message(message="Product deleted successfully")


def _ensure_product_deletable(session: SessionDep, product: Product) -> None:
    """Raise 409 with the referencing documents when the product is in use."""
    variant_ids = session.exec(
        select(ProductVariant.id).where(col(ProductVariant.product_id) == product.id)
    ).all()
    rows = session.exec(
        select(Document, DocumentType.name)
        .join(DocumentType, col(DocumentType.id) == Document.document_type_id)
        .join(DocumentLine, col(DocumentLine.document_id) == Document.id)
        .where(
            or_(
                col(DocumentLine.product_id) == product.id,
                col(DocumentLine.variant_id).in_(variant_ids),
            )
        )
        .distinct()
        .order_by(col(Document.fecha))
    ).all()
    if not rows:
        return
    raise HTTPException(
        status_code=409,
        detail={
            "code": "product_in_use",
            "message": "Product cannot be deleted because it belongs to documents",
            "documents": [
                {
                    "id": str(document.id),
                    "numero": document.numero,
                    "fecha": document.fecha.isoformat(),
                    "total": str(document.total),
                    "estado": document.estado.value,
                    "type_name": type_name,
                }
                for document, type_name in rows
            ],
        },
    )


# ----- Barcodes -----
@router.post(
    "/{product_id}/barcodes",
    response_model=Barcode,
    dependencies=[require_permissions("product.update")],
)
def add_barcode(
    *, session: SessionDep, product_id: uuid.UUID, barcode_in: BarcodeCreate
) -> Any:
    """Add a barcode to a product, optionally scoped to a variant."""
    product = session.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if barcode_in.variant_id is not None:
        variant = session.get(ProductVariant, barcode_in.variant_id)
        if not variant or variant.product_id != product_id:
            raise HTTPException(
                status_code=400, detail="Variant not found in this product"
            )
    existing = session.exec(
        select(Barcode).where(col(Barcode.code) == barcode_in.code)
    ).first()
    if existing:
        raise HTTPException(
            status_code=400, detail="A barcode with this code already exists"
        )
    barcode = Barcode(
        code=barcode_in.code, product_id=product_id, variant_id=barcode_in.variant_id
    )
    session.add(barcode)
    session.commit()
    session.refresh(barcode)
    return barcode


@router.delete(
    "/barcodes/{barcode_id}",
    response_model=Message,
    dependencies=[require_permissions("product.update")],
)
def delete_barcode(session: SessionDep, barcode_id: uuid.UUID) -> Any:
    """Delete a barcode."""
    barcode = session.get(Barcode, barcode_id)
    if not barcode:
        raise HTTPException(status_code=404, detail="Barcode not found")
    session.delete(barcode)
    session.commit()
    return Message(message="Barcode deleted successfully")


# ----- Variants -----
@router.post(
    "/{product_id}/variants",
    response_model=ProductVariantPublic,
    dependencies=[require_permissions("product.create")],
)
def create_variant(
    *, session: SessionDep, product_id: uuid.UUID, variant_in: ProductVariantCreate
) -> Any:
    """Create a variant for a product, linked to its attribute values.

    The combination of attribute values must be unique per product.
    """
    product = session.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    value_ids = list(dict.fromkeys(variant_in.attribute_value_ids))
    values = (
        session.exec(
            select(AttributeValue).where(col(AttributeValue.id).in_(value_ids))
        ).all()
        if value_ids
        else []
    )
    if len(values) != len(value_ids):
        raise HTTPException(
            status_code=400, detail="One or more attribute values not found"
        )
    new_combo = {value.id for value in values}
    for existing in product.variants:
        if {av.id for av in existing.attribute_values} == new_combo:
            raise HTTPException(
                status_code=400,
                detail="A variant with this attribute combination already exists",
            )
    variant = ProductVariant(product_id=product_id, sku_suffix=variant_in.sku_suffix)
    session.add(variant)
    for value in values:
        session.add(
            ProductVariantAttribute(variant_id=variant.id, attribute_value_id=value.id)
        )
    session.commit()
    session.refresh(variant)
    return variant


@router.delete(
    "/variants/{variant_id}",
    response_model=Message,
    dependencies=[require_permissions("product.delete")],
)
def delete_variant(session: SessionDep, variant_id: uuid.UUID) -> Any:
    """Delete a variant."""
    variant = session.get(ProductVariant, variant_id)
    if not variant:
        raise HTTPException(status_code=404, detail="Variant not found")
    session.delete(variant)
    session.commit()
    return Message(message="Variant deleted successfully")
