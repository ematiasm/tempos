import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlalchemy.orm import selectinload
from sqlmodel import col, func, select

from app import crud
from app.api.deps import PaginationDep, SessionDep, require_permissions
from app.models import (
    AttributeValue,
    Barcode,
    BarcodeCreate,
    Category,
    Message,
    Page,
    Product,
    ProductCreate,
    ProductPublic,
    ProductUpdate,
    ProductVariant,
    ProductVariantAttribute,
    ProductVariantCreate,
    ProductVariantPublic,
    UoM,
)

router = APIRouter(prefix="/products", tags=["products"])


@router.get(
    "/",
    response_model=Page[ProductPublic],
    dependencies=[require_permissions("product.read")],
)
def read_products(session: SessionDep, pagination: PaginationDep) -> Any:
    """Retrieve products."""
    count = session.exec(select(func.count()).select_from(Product)).one()
    products = session.exec(
        select(Product)
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
        .offset(pagination.skip)
        .limit(pagination.limit)
    ).all()
    return Page[ProductPublic](
        data=[ProductPublic.model_validate(p) for p in products], count=count
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
    """Deactivate a product (soft delete)."""
    product = session.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    product.is_active = False
    session.add(product)
    session.commit()
    return Message(message="Product deactivated successfully")


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
