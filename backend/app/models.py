import enum
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy import DateTime, Numeric
from sqlmodel import Field, Relationship, SQLModel

from app.validators import normalize_and_validate_documento


def get_datetime_utc() -> datetime:
    return datetime.now(UTC)


class TaxCondition(enum.StrEnum):
    RI = "RI"
    MONOTRIBUTO = "Monotributo"
    EXENTO = "Exento"
    CONSUMIDOR_FINAL = "Consumidor Final"


class TaxType(enum.StrEnum):
    IVA = "IVA"
    IIBB = "IIBB"
    PERC_GAN = "PercGan"
    INTERNO = "Interno"
    OTRO = "Otro"


class TaxAppliesTo(enum.StrEnum):
    LINEA = "linea"
    DOCUMENTO = "documento"


class DocumentOperation(enum.StrEnum):
    VENTA = "venta"
    COMPRA = "compra"
    COTIZACION = "cotizacion"
    AJUSTE = "ajuste"


class CounterpartType(enum.StrEnum):
    CUSTOMER = "customer"
    SUPPLIER = "supplier"


class DocumentStatus(enum.StrEnum):
    ACTIVE = "active"
    VOIDED = "voided"


class FinancialAccountType(enum.StrEnum):
    EFECTIVO = "efectivo"
    BANCO = "banco"
    TARJETA = "tarjeta"
    DIGITAL = "digital"
    CUENTA_CLIENTE = "cuenta_cliente"
    CUENTA_PROVEEDOR = "cuenta_proveedor"


# ---------------------------------------------------------------------------
# User schemas (input)
# ---------------------------------------------------------------------------
class UserBase(SQLModel):
    email: EmailStr = Field(unique=True, index=True, max_length=255)
    is_active: bool = True
    is_superuser: bool = False
    full_name: str | None = Field(default=None, max_length=255)


class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)
    role_ids: list[uuid.UUID] = Field(default_factory=list)


class UserRegister(SQLModel):
    email: EmailStr = Field(max_length=255)
    password: str = Field(min_length=8, max_length=128)
    full_name: str | None = Field(default=None, max_length=255)


class UserUpdate(SQLModel):
    email: EmailStr | None = Field(default=None, max_length=255)
    is_active: bool | None = None
    is_superuser: bool | None = None
    full_name: str | None = Field(default=None, max_length=255)
    password: str | None = Field(default=None, min_length=8, max_length=128)
    role_ids: list[uuid.UUID] | None = None


class UserUpdateMe(SQLModel):
    full_name: str | None = Field(default=None, max_length=255)
    email: EmailStr | None = Field(default=None, max_length=255)


class UpdatePassword(SQLModel):
    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


# ---------------------------------------------------------------------------
# Role / Permission input schemas
# ---------------------------------------------------------------------------
class RoleBase(SQLModel):
    name: str = Field(max_length=100)
    description: str | None = Field(default=None, max_length=255)


class RoleCreate(RoleBase):
    permission_ids: list[uuid.UUID] = Field(default_factory=list)


class RoleUpdate(SQLModel):
    name: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=255)
    permission_ids: list[uuid.UUID] | None = None


class BusinessSettingsUpdate(SQLModel):
    business_name: str | None = Field(default=None, max_length=255)
    address: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=50)
    email: str | None = Field(default=None, max_length=255)
    cuit: str | None = Field(default=None, max_length=20)
    condicion_fiscal: TaxCondition | None = None
    allow_negative_stock: bool | None = None
    enable_variants: bool | None = None
    default_iva: Decimal | None = None


# ---------------------------------------------------------------------------
# Catalog input schemas
# ---------------------------------------------------------------------------
class TaxBase(SQLModel):
    name: str = Field(max_length=100)
    code: str = Field(max_length=50)
    tipo: TaxType
    rate: Decimal = Field(sa_type=Numeric(5, 2))  # type: ignore
    is_percent: bool = True
    aplica_a: TaxAppliesTo = TaxAppliesTo.LINEA
    is_default: bool = False
    is_active: bool = True


class TaxCreate(TaxBase):
    pass


class TaxUpdate(SQLModel):
    name: str | None = Field(default=None, max_length=100)
    code: str | None = Field(default=None, max_length=50)
    tipo: TaxType | None = None
    rate: Decimal | None = Field(default=None, sa_type=Numeric(5, 2))  # type: ignore
    is_percent: bool | None = None
    aplica_a: TaxAppliesTo | None = None
    is_default: bool | None = None
    is_active: bool | None = None


class CategoryBase(SQLModel):
    name: str = Field(max_length=100)


class CategoryCreate(CategoryBase):
    parent_id: uuid.UUID | None = None


class CategoryUpdate(SQLModel):
    name: str | None = Field(default=None, max_length=100)
    parent_id: uuid.UUID | None = None


class UoMBase(SQLModel):
    name: str = Field(max_length=50)
    abbreviation: str = Field(max_length=10)
    decimal_places: int = Field(default=0, ge=0, le=4)


class UoMCreate(UoMBase):
    pass


class UoMUpdate(SQLModel):
    name: str | None = Field(default=None, max_length=50)
    abbreviation: str | None = Field(default=None, max_length=10)
    decimal_places: int | None = Field(default=None, ge=0, le=4)


class BarcodeCreate(SQLModel):
    code: str = Field(min_length=1, max_length=100)
    product_id: uuid.UUID
    variant_id: uuid.UUID | None = None


class ProductBase(SQLModel):
    name: str = Field(min_length=1, max_length=255)
    sku: str | None = Field(default=None, max_length=100)
    category_id: uuid.UUID | None = Field(default=None, foreign_key="category.id")
    uom_id: uuid.UUID = Field(foreign_key="uom.id")
    description: str | None = Field(default=None, max_length=255)
    is_active: bool = True
    margen_pct: Decimal = Field(
        default=Decimal("0"),
        sa_type=Numeric(5, 2),  # type: ignore
    )
    costo_actual: Decimal = Field(
        default=Decimal("0"),
        sa_type=Numeric(12, 2),  # type: ignore
    )
    stock_minimo: Decimal | None = Field(
        default=None,
        sa_type=Numeric(12, 3),  # type: ignore
    )
    stock_maximo: Decimal | None = Field(
        default=None,
        sa_type=Numeric(12, 3),  # type: ignore
    )


class ProductCreate(ProductBase):
    tax_ids: list[uuid.UUID] = Field(default_factory=list)


class ProductUpdate(SQLModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    sku: str | None = Field(default=None, max_length=100)
    category_id: uuid.UUID | None = None
    uom_id: uuid.UUID | None = None
    description: str | None = Field(default=None, max_length=255)
    is_active: bool | None = None
    margen_pct: Decimal | None = Field(
        default=None,
        sa_type=Numeric(5, 2),  # type: ignore
    )
    costo_actual: Decimal | None = Field(
        default=None,
        sa_type=Numeric(12, 2),  # type: ignore
    )
    stock_minimo: Decimal | None = Field(
        default=None,
        sa_type=Numeric(12, 3),  # type: ignore
    )
    stock_maximo: Decimal | None = Field(
        default=None,
        sa_type=Numeric(12, 3),  # type: ignore
    )
    tax_ids: list[uuid.UUID] | None = None


class AttributeBase(SQLModel):
    name: str = Field(max_length=100)


class AttributeCreate(AttributeBase):
    values: list[str] = Field(default_factory=list)


class AttributeUpdate(SQLModel):
    name: str | None = Field(default=None, max_length=100)
    values: list[str] | None = None


class ProductVariantCreate(SQLModel):
    product_id: uuid.UUID
    sku_suffix: str | None = Field(default=None, max_length=50)
    attribute_value_ids: list[uuid.UUID] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Counterparty input schemas (customers / suppliers)
# ---------------------------------------------------------------------------
# Name of the seeded default customer; protected from delete/deactivation.
CONSUMIDOR_FINAL_NAME = "Consumidor Final"


def _validate_documento_field(value: str | None) -> str | None:
    """Shared ``field_validator`` body for counterparty documento fields."""
    return normalize_and_validate_documento(value)


class CustomerBase(SQLModel):
    razon_social: str = Field(min_length=1, max_length=255)
    documento: str | None = Field(default=None, max_length=20)
    phone: str | None = Field(default=None, max_length=50)
    email: str | None = Field(default=None, max_length=255)
    address: str | None = Field(default=None, max_length=255)
    condicion_fiscal: TaxCondition = Field(
        default=TaxCondition.CONSUMIDOR_FINAL, max_length=20
    )
    limite_credito: Decimal = Field(
        default=Decimal("0"),
        sa_type=Numeric(12, 2),  # type: ignore
    )
    is_active: bool = True

    @field_validator("documento")
    @classmethod
    def _check_documento(cls, value: str | None) -> str | None:
        return _validate_documento_field(value)


class CustomerCreate(CustomerBase):
    pass


class CustomerUpdate(SQLModel):
    razon_social: str | None = Field(default=None, min_length=1, max_length=255)
    documento: str | None = Field(default=None, max_length=20)
    phone: str | None = Field(default=None, max_length=50)
    email: str | None = Field(default=None, max_length=255)
    address: str | None = Field(default=None, max_length=255)
    condicion_fiscal: TaxCondition | None = None
    limite_credito: Decimal | None = Field(
        default=None,
        sa_type=Numeric(12, 2),  # type: ignore
    )
    is_active: bool | None = None

    @field_validator("documento")
    @classmethod
    def _check_documento(cls, value: str | None) -> str | None:
        return _validate_documento_field(value)


class SupplierBase(SQLModel):
    razon_social: str = Field(min_length=1, max_length=255)
    documento: str | None = Field(default=None, max_length=20)
    phone: str | None = Field(default=None, max_length=50)
    email: str | None = Field(default=None, max_length=255)
    address: str | None = Field(default=None, max_length=255)
    condicion_fiscal: TaxCondition = Field(
        default=TaxCondition.CONSUMIDOR_FINAL, max_length=20
    )
    is_active: bool = True

    @field_validator("documento")
    @classmethod
    def _check_documento(cls, value: str | None) -> str | None:
        return _validate_documento_field(value)


class SupplierCreate(SupplierBase):
    pass


class SupplierUpdate(SQLModel):
    razon_social: str | None = Field(default=None, min_length=1, max_length=255)
    documento: str | None = Field(default=None, max_length=20)
    phone: str | None = Field(default=None, max_length=50)
    email: str | None = Field(default=None, max_length=255)
    address: str | None = Field(default=None, max_length=255)
    condicion_fiscal: TaxCondition | None = None
    is_active: bool | None = None

    @field_validator("documento")
    @classmethod
    def _check_documento(cls, value: str | None) -> str | None:
        return _validate_documento_field(value)


# ---------------------------------------------------------------------------
# Document input schemas
# ---------------------------------------------------------------------------
class DocumentTypeUpdate(SQLModel):
    """Editable fields of a document type; signs and operation stay fixed."""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    prefix: str | None = Field(default=None, min_length=1, max_length=10)
    is_active: bool | None = None


class DocumentLineCreate(SQLModel):
    product_id: uuid.UUID
    variant_id: uuid.UUID | None = None
    cantidad: Decimal = Field(
        gt=0,
        sa_type=Numeric(12, 3),  # type: ignore
    )
    precio_unit: Decimal | None = Field(
        default=None,
        sa_type=Numeric(12, 2),  # type: ignore
    )
    descuento_pct: Decimal = Field(
        default=Decimal("0"),
        ge=0,
        le=100,
        sa_type=Numeric(5, 2),  # type: ignore
    )
    descuento_monto: Decimal | None = Field(
        default=None,
        ge=0,
        sa_type=Numeric(12, 2),  # type: ignore
    )
    # None = auto-apply the product's line taxes; a list overrides them.
    tax_ids: list[uuid.UUID] | None = None
    # Normally omitted (snapshots Product.costo_actual); NC creation passes
    # the original line's snapshot so the reversal is exact.
    costo_unitario: Decimal | None = Field(
        default=None,
        sa_type=Numeric(12, 2),  # type: ignore
    )


class DocumentVoidLine(SQLModel):
    document_line_id: uuid.UUID
    cantidad: Decimal = Field(
        gt=0,
        sa_type=Numeric(12, 3),  # type: ignore
    )


class DocumentVoidCreate(SQLModel):
    """Empty ``lines`` voids everything still pending (total void)."""

    lines: list[DocumentVoidLine] = Field(default_factory=list)
    payments: list["DocumentPaymentCreate"] = Field(default_factory=list)


class DocumentPaymentCreate(SQLModel):
    payment_method_id: uuid.UUID
    monto: Decimal = Field(
        gt=0,
        sa_type=Numeric(12, 2),  # type: ignore
    )
    comision_pct: Decimal | None = Field(
        default=None,
        sa_type=Numeric(5, 2),  # type: ignore
    )
    fecha_acreditacion: datetime | None = None


class DocumentCreate(SQLModel):
    document_type_id: uuid.UUID
    contraparte_id: uuid.UUID | None = None
    fecha: datetime | None = None
    descuento_total: Decimal = Field(
        default=Decimal("0"),
        ge=0,
        sa_type=Numeric(12, 2),  # type: ignore
    )
    lines: list[DocumentLineCreate] = Field(min_length=1)
    payments: list[DocumentPaymentCreate] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Link tables (must be defined before main tables that reference them
# as ``link_model`` in Relationship calls)
# ---------------------------------------------------------------------------
class UserRole(SQLModel, table=True):
    user_id: uuid.UUID = Field(
        foreign_key="user.id", primary_key=True, ondelete="CASCADE"
    )
    role_id: uuid.UUID = Field(
        foreign_key="role.id", primary_key=True, ondelete="CASCADE"
    )


class RolePermission(SQLModel, table=True):
    role_id: uuid.UUID = Field(
        foreign_key="role.id", primary_key=True, ondelete="CASCADE"
    )
    permission_id: uuid.UUID = Field(
        foreign_key="permission.id", primary_key=True, ondelete="CASCADE"
    )


class ProductTax(SQLModel, table=True):
    product_id: uuid.UUID = Field(
        foreign_key="product.id", primary_key=True, ondelete="CASCADE"
    )
    tax_id: uuid.UUID = Field(
        foreign_key="tax.id", primary_key=True, ondelete="CASCADE"
    )


class ProductVariantAttribute(SQLModel, table=True):
    variant_id: uuid.UUID = Field(
        foreign_key="productvariant.id", primary_key=True, ondelete="CASCADE"
    )
    attribute_value_id: uuid.UUID = Field(
        foreign_key="attributevalue.id", primary_key=True, ondelete="CASCADE"
    )


# ---------------------------------------------------------------------------
# Database tables
# ---------------------------------------------------------------------------
class User(UserBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    hashed_password: str
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    items: list[Item] = Relationship(back_populates="owner", cascade_delete=True)
    roles: list[Role] = Relationship(back_populates="users", link_model=UserRole)


class Role(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str = Field(unique=True, index=True, max_length=100)
    description: str | None = Field(default=None, max_length=255)
    permissions: list[Permission] = Relationship(
        back_populates="roles", link_model=RolePermission
    )
    users: list[User] = Relationship(back_populates="roles", link_model=UserRole)


class Permission(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    code: str = Field(unique=True, index=True, max_length=100)
    description: str | None = Field(default=None, max_length=255)
    roles: list[Role] = Relationship(
        back_populates="permissions", link_model=RolePermission
    )


class BusinessSettings(SQLModel, table=True):
    id: int = Field(default=1, primary_key=True)
    business_name: str = Field(max_length=255)
    address: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=50)
    email: str | None = Field(default=None, max_length=255)
    cuit: str | None = Field(default=None, max_length=20)
    condicion_fiscal: TaxCondition = Field(
        default=TaxCondition.CONSUMIDOR_FINAL, max_length=20
    )
    allow_negative_stock: bool = Field(default=False)
    enable_variants: bool = Field(default=False)
    default_iva: Decimal | None = Field(
        default=None,
        sa_type=Numeric(5, 2),  # type: ignore
    )


# ---------------------------------------------------------------------------
# Catalog database tables
# ---------------------------------------------------------------------------
class Tax(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str = Field(max_length=100)
    code: str = Field(unique=True, index=True, max_length=50)
    tipo: TaxType = Field(default=TaxType.IVA, max_length=20)
    rate: Decimal = Field(
        default=Decimal("0"),
        sa_type=Numeric(5, 2),  # type: ignore
    )
    is_percent: bool = True
    aplica_a: TaxAppliesTo = Field(default=TaxAppliesTo.LINEA, max_length=20)
    is_default: bool = False
    is_active: bool = True
    products: list["Product"] = Relationship(
        back_populates="taxes", link_model=ProductTax
    )


class Category(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str = Field(max_length=100)
    parent_id: uuid.UUID | None = Field(
        default=None, foreign_key="category.id", ondelete="SET NULL"
    )
    parent: Optional[Category] = Relationship(  # noqa: UP045
        back_populates="children",
        sa_relationship_kwargs={"remote_side": "Category.id"},  # type: ignore[assignment]
    )
    children: list["Category"] = Relationship(back_populates="parent")  # noqa: UP045
    products: list["Product"] = Relationship(back_populates="category")  # noqa: UP045


class UoM(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str = Field(max_length=50)
    abbreviation: str = Field(max_length=10)
    decimal_places: int = Field(default=0, ge=0, le=4)
    products: list["Product"] = Relationship(back_populates="uom")  # noqa: UP045


class Product(ProductBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    precio_venta: Decimal = Field(
        default=Decimal("0"),
        sa_type=Numeric(12, 2),  # type: ignore
    )
    stock_current: Decimal = Field(
        default=Decimal("0"),
        sa_type=Numeric(12, 3),  # type: ignore
    )
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    category: Optional["Category"] = Relationship(back_populates="products")
    uom: Optional["UoM"] = Relationship(back_populates="products")
    taxes: list["Tax"] = Relationship(back_populates="products", link_model=ProductTax)  # noqa: UP045
    variants: list["ProductVariant"] = Relationship(  # noqa: UP045
        back_populates="product", cascade_delete=True
    )
    barcodes: list["Barcode"] = Relationship(  # noqa: UP045
        back_populates="product", cascade_delete=True
    )


class ProductVariant(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    product_id: uuid.UUID = Field(
        foreign_key="product.id", nullable=False, ondelete="CASCADE"
    )
    sku_suffix: str | None = Field(default=None, max_length=50)
    stock_current: Decimal = Field(
        default=Decimal("0"),
        sa_type=Numeric(12, 3),  # type: ignore
    )
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    product: Optional[Product] = Relationship(back_populates="variants")  # noqa: UP045
    barcodes: list["Barcode"] = Relationship(  # noqa: UP045
        back_populates="variant", cascade_delete=True
    )
    attribute_values: list["AttributeValue"] = Relationship(  # noqa: UP045
        back_populates="variants", link_model=ProductVariantAttribute
    )


class Barcode(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    code: str = Field(unique=True, index=True, max_length=100)
    product_id: uuid.UUID = Field(
        foreign_key="product.id", nullable=False, ondelete="CASCADE"
    )
    variant_id: uuid.UUID | None = Field(
        default=None, foreign_key="productvariant.id", ondelete="CASCADE"
    )
    product: Optional[Product] = Relationship(back_populates="barcodes")  # noqa: UP045
    variant: Optional[ProductVariant] = Relationship(back_populates="barcodes")  # noqa: UP045


class Attribute(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str = Field(max_length=100)
    values: list["AttributeValue"] = Relationship(  # noqa: UP045
        back_populates="attribute", cascade_delete=True
    )


class AttributeValue(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    attribute_id: uuid.UUID = Field(
        foreign_key="attribute.id", nullable=False, ondelete="CASCADE"
    )
    value: str = Field(max_length=100)
    attribute: Optional[Attribute] = Relationship(back_populates="values")  # noqa: UP045
    variants: list["ProductVariant"] = Relationship(  # noqa: UP045
        back_populates="attribute_values", link_model=ProductVariantAttribute
    )


# ---------------------------------------------------------------------------
# Counterparty database tables
# ---------------------------------------------------------------------------
class Customer(CustomerBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    documento: str | None = Field(default=None, max_length=20, unique=True, index=True)
    saldo: Decimal = Field(
        default=Decimal("0"),
        sa_type=Numeric(12, 2),  # type: ignore
    )
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


class Supplier(SupplierBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    documento: str | None = Field(default=None, max_length=20, unique=True, index=True)
    saldo: Decimal = Field(
        default=Decimal("0"),
        sa_type=Numeric(12, 2),  # type: ignore
    )
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


# ---------------------------------------------------------------------------
# Finance tables (schema only in phase 4a; ledger lands with phases 6+7)
# ---------------------------------------------------------------------------
class FinancialAccount(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str = Field(max_length=100)
    tipo: FinancialAccountType = Field(max_length=20)
    saldo: Decimal = Field(
        default=Decimal("0"),
        sa_type=Numeric(12, 2),  # type: ignore
    )
    currency: str = Field(default="ARS", max_length=10)
    payment_methods: list["PaymentMethod"] = Relationship(
        back_populates="financial_account"
    )


class PaymentMethod(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str = Field(max_length=100)
    financial_account_id: uuid.UUID = Field(
        foreign_key="financialaccount.id", nullable=False
    )
    requiere_conciliacion: bool = Field(default=False)
    financial_account: Optional[FinancialAccount] = Relationship(  # noqa: UP045
        back_populates="payment_methods"
    )


# ---------------------------------------------------------------------------
# Document tables (Odoo-style unified documents)
# ---------------------------------------------------------------------------
class DocumentType(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str = Field(max_length=100)
    prefix: str = Field(unique=True, index=True, max_length=10)
    operation: DocumentOperation = Field(max_length=20)
    signo_stock: int = Field(default=0)
    signo_caja: int = Field(default=0)
    es_fiscal: bool = Field(default=False)
    tipo_contraparte: CounterpartType | None = Field(default=None, max_length=20)
    is_active: bool = True
    # Seed-managed: the NC type used to void documents of this type; NULL
    # means the type is not voidable.
    void_document_type_id: uuid.UUID | None = Field(
        default=None, foreign_key="documenttype.id"
    )
    documents: list["Document"] = Relationship(back_populates="document_type")


class DocumentSequence(SQLModel, table=True):
    """Per document type / year counters; claimed with SELECT FOR UPDATE."""

    document_type_id: uuid.UUID = Field(
        foreign_key="documenttype.id", primary_key=True, ondelete="CASCADE"
    )
    year: int = Field(primary_key=True)
    last_number: int = Field(default=0)


class Document(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    document_type_id: uuid.UUID = Field(foreign_key="documenttype.id", nullable=False)
    numero: str = Field(unique=True, index=True, max_length=30)
    year: int
    fecha: datetime = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    contraparte_type: CounterpartType | None = Field(default=None, max_length=20)
    contraparte_id: uuid.UUID | None = Field(default=None, index=True)
    user_id: uuid.UUID = Field(foreign_key="user.id", nullable=False)
    estado: DocumentStatus = Field(default=DocumentStatus.ACTIVE, max_length=20)
    subtotal: Decimal = Field(
        default=Decimal("0"),
        sa_type=Numeric(12, 2),  # type: ignore
    )
    descuento_total: Decimal = Field(
        default=Decimal("0"),
        sa_type=Numeric(12, 2),  # type: ignore
    )
    total: Decimal = Field(
        default=Decimal("0"),
        sa_type=Numeric(12, 2),  # type: ignore
    )
    parent_document_id: uuid.UUID | None = Field(
        default=None, foreign_key="document.id"
    )
    # Reserved for the future AFIP/ARCA integration; unused until then.
    cae: str | None = Field(default=None, max_length=20)
    cae_vto: datetime | None = Field(
        default=None,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    document_type: Optional[DocumentType] = Relationship(back_populates="documents")  # noqa: UP045
    lines: list["DocumentLine"] = Relationship(
        back_populates="document", cascade_delete=True
    )
    taxes: list["DocumentTax"] = Relationship(
        back_populates="document", cascade_delete=True
    )
    payments: list["DocumentPayment"] = Relationship(
        back_populates="document", cascade_delete=True
    )


class DocumentLine(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    document_id: uuid.UUID = Field(
        foreign_key="document.id", nullable=False, ondelete="CASCADE"
    )
    orden: int = Field(default=0)
    product_id: uuid.UUID = Field(foreign_key="product.id", nullable=False)
    variant_id: uuid.UUID | None = Field(default=None, foreign_key="productvariant.id")
    cantidad: Decimal = Field(
        default=Decimal("1"),
        sa_type=Numeric(12, 3),  # type: ignore
    )
    precio_unit: Decimal = Field(
        default=Decimal("0"),
        sa_type=Numeric(12, 2),  # type: ignore
    )
    # Sale-time cost snapshot; required for historical margin reports.
    costo_unitario: Decimal = Field(
        default=Decimal("0"),
        sa_type=Numeric(12, 2),  # type: ignore
    )
    descuento_pct: Decimal = Field(
        default=Decimal("0"),
        sa_type=Numeric(5, 2),  # type: ignore
    )
    descuento_monto: Decimal = Field(
        default=Decimal("0"),
        sa_type=Numeric(12, 2),  # type: ignore
    )
    subtotal_line: Decimal = Field(
        default=Decimal("0"),
        sa_type=Numeric(12, 2),  # type: ignore
    )
    # Line of the parent document this line reverts (set on NC lines).
    parent_line_id: uuid.UUID | None = Field(
        default=None, foreign_key="documentline.id"
    )
    document: Optional[Document] = Relationship(back_populates="lines")  # noqa: UP045
    taxes: list["DocumentLineTax"] = Relationship(
        back_populates="line", cascade_delete=True
    )


class DocumentLineTax(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    document_line_id: uuid.UUID = Field(
        foreign_key="documentline.id", nullable=False, ondelete="CASCADE"
    )
    tax_id: uuid.UUID = Field(foreign_key="tax.id", nullable=False)
    base: Decimal = Field(
        default=Decimal("0"),
        sa_type=Numeric(12, 2),  # type: ignore
    )
    monto: Decimal = Field(
        default=Decimal("0"),
        sa_type=Numeric(12, 2),  # type: ignore
    )
    aplicado: bool = Field(default=True)
    line: Optional[DocumentLine] = Relationship(back_populates="taxes")  # noqa: UP045


class DocumentTax(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    document_id: uuid.UUID = Field(
        foreign_key="document.id", nullable=False, ondelete="CASCADE"
    )
    tax_id: uuid.UUID = Field(foreign_key="tax.id", nullable=False)
    base: Decimal = Field(
        default=Decimal("0"),
        sa_type=Numeric(12, 2),  # type: ignore
    )
    monto: Decimal = Field(
        default=Decimal("0"),
        sa_type=Numeric(12, 2),  # type: ignore
    )
    document: Optional[Document] = Relationship(back_populates="taxes")  # noqa: UP045


class DocumentPayment(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    document_id: uuid.UUID = Field(
        foreign_key="document.id", nullable=False, ondelete="CASCADE"
    )
    payment_method_id: uuid.UUID = Field(foreign_key="paymentmethod.id", nullable=False)
    monto: Decimal = Field(
        default=Decimal("0"),
        sa_type=Numeric(12, 2),  # type: ignore
    )
    comision_pct: Decimal | None = Field(
        default=None,
        sa_type=Numeric(5, 2),  # type: ignore
    )
    fecha_acreditacion: datetime | None = Field(
        default=None,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    conciliado: bool = Field(default=False)
    document: Optional[Document] = Relationship(back_populates="payments")  # noqa: UP045


# ---------------------------------------------------------------------------
# Output schemas (no table)
# ---------------------------------------------------------------------------
class PermissionPublic(SQLModel):
    id: uuid.UUID
    code: str
    description: str | None = None


class RolePublic(RoleBase):
    id: uuid.UUID
    permissions: list[PermissionPublic] = []


class UserPublic(UserBase):
    id: uuid.UUID
    created_at: datetime | None = None
    roles: list[RolePublic] = []


class BusinessSettingsPublic(SQLModel):
    id: int
    business_name: str
    address: str | None = None
    phone: str | None = None
    email: str | None = None
    cuit: str | None = None
    condicion_fiscal: TaxCondition
    allow_negative_stock: bool
    enable_variants: bool
    default_iva: Decimal | None = None


# ---------------------------------------------------------------------------
# Catalog output schemas
# ---------------------------------------------------------------------------
class TaxPublic(TaxBase):
    id: uuid.UUID


class CategoryPublic(CategoryBase):
    id: uuid.UUID
    parent_id: uuid.UUID | None = None


class UoMPublic(UoMBase):
    id: uuid.UUID


class BarcodePublic(SQLModel):
    id: uuid.UUID
    code: str
    product_id: uuid.UUID
    variant_id: uuid.UUID | None = None


class AttributeValuePublic(SQLModel):
    id: uuid.UUID
    attribute_id: uuid.UUID
    value: str


class AttributePublic(SQLModel):
    id: uuid.UUID
    name: str
    values: list[AttributeValuePublic] = []


class ProductVariantPublic(SQLModel):
    id: uuid.UUID
    product_id: uuid.UUID
    sku_suffix: str | None = None
    stock_current: Decimal
    barcodes: list[BarcodePublic] = []
    attribute_values: list[AttributeValuePublic] = []


class ProductPublic(SQLModel):
    id: uuid.UUID
    name: str
    sku: str | None = None
    category_id: uuid.UUID | None = None
    uom_id: uuid.UUID
    description: str | None = None
    is_active: bool
    margen_pct: Decimal
    costo_actual: Decimal
    precio_venta: Decimal
    stock_current: Decimal
    stock_minimo: Decimal | None = None
    stock_maximo: Decimal | None = None
    created_at: datetime | None = None
    taxes: list[TaxPublic] = []
    variants: list[ProductVariantPublic] = []
    barcodes: list[BarcodePublic] = []


# ---------------------------------------------------------------------------
# Counterparty output schemas
# ---------------------------------------------------------------------------
class CustomerPublic(CustomerBase):
    id: uuid.UUID
    saldo: Decimal
    created_at: datetime | None = None


class SupplierPublic(SupplierBase):
    id: uuid.UUID
    saldo: Decimal
    created_at: datetime | None = None


# ---------------------------------------------------------------------------
# Finance / document output schemas
# ---------------------------------------------------------------------------
class FinancialAccountPublic(SQLModel):
    id: uuid.UUID
    name: str
    tipo: FinancialAccountType
    saldo: Decimal
    currency: str


class PaymentMethodPublic(SQLModel):
    id: uuid.UUID
    name: str
    financial_account_id: uuid.UUID
    requiere_conciliacion: bool


class DocumentTypePublic(SQLModel):
    id: uuid.UUID
    name: str
    prefix: str
    operation: DocumentOperation
    signo_stock: int
    signo_caja: int
    es_fiscal: bool
    tipo_contraparte: CounterpartType | None = None
    void_document_type_id: uuid.UUID | None = None
    is_active: bool


class DocumentLineTaxPublic(SQLModel):
    id: uuid.UUID
    tax_id: uuid.UUID
    base: Decimal
    monto: Decimal
    aplicado: bool


class DocumentLinePublic(SQLModel):
    id: uuid.UUID
    orden: int
    product_id: uuid.UUID
    variant_id: uuid.UUID | None = None
    cantidad: Decimal
    precio_unit: Decimal
    costo_unitario: Decimal
    descuento_pct: Decimal
    descuento_monto: Decimal
    subtotal_line: Decimal
    taxes: list[DocumentLineTaxPublic] = []
    # Quantity still voidable; only filled by the document detail endpoint.
    cantidad_pendiente: Decimal | None = None


class DocumentTaxPublic(SQLModel):
    id: uuid.UUID
    tax_id: uuid.UUID
    base: Decimal
    monto: Decimal


class DocumentPaymentPublic(SQLModel):
    id: uuid.UUID
    payment_method_id: uuid.UUID
    monto: Decimal
    comision_pct: Decimal | None = None
    fecha_acreditacion: datetime | None = None
    conciliado: bool


class DocumentPublic(SQLModel):
    id: uuid.UUID
    document_type_id: uuid.UUID
    numero: str
    year: int
    fecha: datetime
    contraparte_type: CounterpartType | None = None
    contraparte_id: uuid.UUID | None = None
    user_id: uuid.UUID
    estado: DocumentStatus
    subtotal: Decimal
    descuento_total: Decimal
    total: Decimal
    parent_document_id: uuid.UUID | None = None
    created_at: datetime | None = None
    document_type: DocumentTypePublic
    lines: list[DocumentLinePublic] = []
    taxes: list[DocumentTaxPublic] = []
    payments: list[DocumentPaymentPublic] = []
    # Resolved from the polymorphic counterpart (customer/supplier name).
    contraparte_name: str | None = None


# ---------------------------------------------------------------------------
# Generic pagination envelope
# ---------------------------------------------------------------------------
class Page[T](BaseModel):
    data: list[T]
    count: int


# ---------------------------------------------------------------------------
# Item models (existing, kept for template compatibility)
# ---------------------------------------------------------------------------
class ItemBase(SQLModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=255)


class ItemCreate(ItemBase):
    pass


class ItemUpdate(SQLModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=255)


class Item(ItemBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    owner_id: uuid.UUID = Field(
        foreign_key="user.id", nullable=False, ondelete="CASCADE"
    )
    owner: User | None = Relationship(back_populates="items")


class ItemPublic(ItemBase):
    id: uuid.UUID
    owner_id: uuid.UUID
    created_at: datetime | None = None


# ---------------------------------------------------------------------------
# Misc schemas
# ---------------------------------------------------------------------------
class Message(SQLModel):
    message: str


class Token(SQLModel):
    access_token: str
    token_type: str = "bearer"


class TokenPayload(SQLModel):
    sub: str | None = None


class NewPassword(SQLModel):
    token: str
    new_password: str = Field(min_length=8, max_length=128)
