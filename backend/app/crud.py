import uuid
from decimal import Decimal
from typing import Any

from sqlmodel import Session, col, delete, select

from app.core.security import get_password_hash, verify_password
from app.models import (
    Attribute,
    AttributeCreate,
    AttributeValue,
    Item,
    ItemCreate,
    Product,
    ProductCreate,
    ProductTax,
    ProductUpdate,
    ProductVariantAttribute,
    Role,
    User,
    UserCreate,
    UserRole,
    UserUpdate,
)


def create_user(*, session: Session, user_create: UserCreate) -> User:
    db_obj = User.model_validate(
        user_create, update={"hashed_password": get_password_hash(user_create.password)}
    )
    session.add(db_obj)
    session.commit()
    session.refresh(db_obj)
    _sync_user_roles(session, db_obj, user_create.role_ids)
    session.refresh(db_obj)
    return db_obj


def update_user(*, session: Session, db_user: User, user_in: UserUpdate) -> Any:
    user_data = user_in.model_dump(exclude_unset=True)
    extra_data = {}
    if "password" in user_data:
        password = user_data["password"]
        hashed_password = get_password_hash(password)
        extra_data["hashed_password"] = hashed_password
    db_user.sqlmodel_update(user_data, update=extra_data)
    session.add(db_user)
    session.commit()
    session.refresh(db_user)
    role_ids = user_data.pop("role_ids", None) if "role_ids" in user_data else None
    if role_ids is not None:
        _sync_user_roles(session, db_user, role_ids)
        session.refresh(db_user)
    return db_user


def get_user_by_email(*, session: Session, email: str) -> User | None:
    statement = select(User).where(User.email == email)
    session_user = session.exec(statement).first()
    return session_user


# Dummy hash to use for timing attack prevention when user is not found
# This is an Argon2 hash of a random password, used to ensure constant-time comparison
DUMMY_HASH = "$argon2id$v=19$m=65536,t=3,p=4$MjQyZWE1MzBjYjJlZTI0Yw$YTU4NGM5ZTZmYjE2NzZlZjY0ZWY3ZGRkY2U2OWFjNjk"


def authenticate(*, session: Session, email: str, password: str) -> User | None:
    db_user = get_user_by_email(session=session, email=email)
    if not db_user:
        # Prevent timing attacks by running password verification even when user doesn't exist
        # This ensures the response time is similar whether or not the email exists
        verify_password(password, DUMMY_HASH)
        return None
    verified, updated_password_hash = verify_password(password, db_user.hashed_password)
    if not verified:
        return None
    if updated_password_hash:
        db_user.hashed_password = updated_password_hash
        session.add(db_user)
        session.commit()
        session.refresh(db_user)
    return db_user


def create_item(*, session: Session, item_in: ItemCreate, owner_id: uuid.UUID) -> Item:
    db_item = Item.model_validate(item_in, update={"owner_id": owner_id})
    session.add(db_item)
    session.commit()
    session.refresh(db_item)
    return db_item


def _sync_user_roles(session: Session, user: User, role_ids: list[uuid.UUID]) -> None:
    """Replace all role assignments for ``user`` so that only ``role_ids`` remain."""
    session.exec(delete(UserRole).where(col(UserRole.user_id) == user.id))
    for rid in role_ids:
        role = session.get(Role, rid)
        if role:
            session.add(UserRole(user_id=user.id, role_id=rid))
    session.commit()


def _compute_precio_venta(costo_actual: Decimal, margen_pct: Decimal) -> Decimal:
    """precio_venta = costo_actual * (1 + margen_pct / 100), rounded to 2 decimals."""
    return (costo_actual * (Decimal("1") + margen_pct / Decimal("100"))).quantize(
        Decimal("0.01")
    )


def create_product(*, session: Session, product_in: ProductCreate) -> Product:
    precio_venta = _compute_precio_venta(product_in.costo_actual, product_in.margen_pct)
    db_obj = Product.model_validate(product_in, update={"precio_venta": precio_venta})
    session.add(db_obj)
    session.commit()
    session.refresh(db_obj)
    _sync_product_taxes(session, db_obj, product_in.tax_ids)
    session.refresh(db_obj)
    return db_obj


def update_product(
    *, session: Session, db_product: Product, product_in: ProductUpdate
) -> Any:
    data = product_in.model_dump(exclude_unset=True)
    tax_ids = data.pop("tax_ids", None) if "tax_ids" in data else None
    needs_recompute = "costo_actual" in data or "margen_pct" in data
    db_product.sqlmodel_update(data)
    if needs_recompute:
        db_product.precio_venta = _compute_precio_venta(
            db_product.costo_actual, db_product.margen_pct
        )
    session.add(db_product)
    session.commit()
    session.refresh(db_product)
    if tax_ids is not None:
        _sync_product_taxes(session, db_product, tax_ids)
        session.refresh(db_product)
    return db_product


def _sync_product_taxes(
    session: Session, product: Product, tax_ids: list[uuid.UUID]
) -> None:
    """Replace all tax assignments for ``product`` so that only ``tax_ids`` remain."""
    session.exec(delete(ProductTax).where(col(ProductTax.product_id) == product.id))
    for tid in tax_ids:
        session.add(ProductTax(product_id=product.id, tax_id=tid))
    session.commit()


def create_attribute(*, session: Session, attribute_in: AttributeCreate) -> Attribute:
    """Create an attribute together with its values (blank/duplicated ignored)."""
    attribute = Attribute(name=attribute_in.name)
    session.add(attribute)
    seen: set[str] = set()
    for raw_value in attribute_in.values:
        value = raw_value.strip()
        if value and value.casefold() not in seen:
            seen.add(value.casefold())
            session.add(AttributeValue(attribute_id=attribute.id, value=value))
    session.commit()
    session.refresh(attribute)
    return attribute


def sync_attribute_values(
    *, session: Session, attribute: Attribute, values: list[str]
) -> None:
    """Replace the values of ``attribute`` so that only ``values`` remain.

    New values are created; values absent from the list are removed unless they
    are referenced by a product variant, in which case ``ValueError`` is raised.
    """
    desired = {raw.strip() for raw in values if raw.strip()}
    existing_values = {av.value: av for av in attribute.values}
    to_remove = [av for av in attribute.values if av.value not in desired]
    if to_remove:
        removable_ids = [av.id for av in to_remove]
        in_use = session.exec(
            select(ProductVariantAttribute).where(
                col(ProductVariantAttribute.attribute_value_id).in_(removable_ids)
            )
        ).first()
        if in_use:
            raise ValueError("Some attribute values are in use by product variants")
        for attribute_value in to_remove:
            session.delete(attribute_value)
    for value in desired:
        if value not in existing_values:
            session.add(AttributeValue(attribute_id=attribute.id, value=value))
    session.commit()
    session.refresh(attribute)
