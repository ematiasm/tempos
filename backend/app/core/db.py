from decimal import Decimal

from sqlmodel import Session, create_engine, select

from app import crud
from app.core.config import settings
from app.models import (
    CONSUMIDOR_FINAL_NAME,
    BusinessSettings,
    CounterpartType,
    Customer,
    DocumentOperation,
    DocumentType,
    FinancialAccount,
    FinancialAccountType,
    PaymentMethod,
    Permission,
    Role,
    RolePermission,
    TaxAppliesTo,
    TaxCondition,
    TaxType,
    UoM,
    User,
    UserCreate,
    UserRole,
)
from app.models import (
    Tax as TaxModel,
)

engine = create_engine(str(settings.SQLALCHEMY_DATABASE_URI))


# make sure all SQLModel models are imported (app.models) before initializing DB
# otherwise, SQLModel might fail to initialize relationships properly
# for more details: https://github.com/fastapi/full-stack-fastapi-template/issues/28

# Seeded permission codes following the ``resource.action`` convention.
SEED_PERMISSIONS: list[tuple[str, str]] = [
    ("user.read", "View users"),
    ("user.create", "Create users"),
    ("user.update", "Update users"),
    ("user.delete", "Delete users"),
    ("role.read", "View roles"),
    ("role.create", "Create roles"),
    ("role.update", "Update roles"),
    ("role.delete", "Delete roles"),
    ("permission.read", "View permissions"),
    ("settings.read", "View business settings"),
    ("settings.update", "Update business settings"),
    ("product.read", "View products"),
    ("product.create", "Create products"),
    ("product.update", "Update products"),
    ("product.delete", "Delete products"),
    ("category.read", "View categories"),
    ("category.create", "Create categories"),
    ("category.update", "Update categories"),
    ("category.delete", "Delete categories"),
    ("customer.read", "View customers"),
    ("customer.create", "Create customers"),
    ("customer.update", "Update customers"),
    ("customer.delete", "Delete customers"),
    ("supplier.read", "View suppliers"),
    ("supplier.create", "Create suppliers"),
    ("supplier.update", "Update suppliers"),
    ("supplier.delete", "Delete suppliers"),
    ("document.read", "View documents"),
    ("document.create", "Create documents"),
    ("document.void", "Void documents"),
    ("stock.read", "View stock movements"),
    ("stock.adjust", "Adjust stock"),
    ("finance.read", "View financial accounts"),
    ("finance.create", "Create financial transactions"),
    ("finance.update", "Update financial transactions"),
    ("transfer.create", "Create internal transfers"),
    ("report.view", "View reports"),
]

# Seeded document types. Signs: stock/caja direction of the operation.
# Only name/prefix are user-editable afterwards.
SEED_DOCUMENT_TYPES: list[
    tuple[str, str, DocumentOperation, int, int, bool, CounterpartType | None]
] = [
    (
        "Factura A",
        "FA",
        DocumentOperation.VENTA,
        -1,
        +1,
        True,
        CounterpartType.CUSTOMER,
    ),
    (
        "Factura B",
        "FB",
        DocumentOperation.VENTA,
        -1,
        +1,
        True,
        CounterpartType.CUSTOMER,
    ),
    (
        "Factura C",
        "FC",
        DocumentOperation.VENTA,
        -1,
        +1,
        True,
        CounterpartType.CUSTOMER,
    ),
    ("Ticket", "TCK", DocumentOperation.VENTA, -1, +1, False, CounterpartType.CUSTOMER),
    (
        "Cotización",
        "COT",
        DocumentOperation.COTIZACION,
        0,
        0,
        False,
        CounterpartType.CUSTOMER,
    ),
    (
        "Nota de Crédito",
        "NCV",
        DocumentOperation.VENTA,
        +1,
        -1,
        True,
        CounterpartType.CUSTOMER,
    ),
    (
        "Nota de Débito",
        "NDV",
        DocumentOperation.VENTA,
        -1,
        +1,
        True,
        CounterpartType.CUSTOMER,
    ),
    (
        "Orden de Compra",
        "OC",
        DocumentOperation.COMPRA,
        +1,
        -1,
        False,
        CounterpartType.SUPPLIER,
    ),
    (
        "NC Compra",
        "NCC",
        DocumentOperation.COMPRA,
        -1,
        +1,
        False,
        CounterpartType.SUPPLIER,
    ),
    (
        "ND Compra",
        "NDC",
        DocumentOperation.COMPRA,
        +1,
        -1,
        False,
        CounterpartType.SUPPLIER,
    ),
    ("Remito", "RTO", DocumentOperation.VENTA, -1, 0, False, CounterpartType.CUSTOMER),
    ("Ajuste Stock", "AJS", DocumentOperation.AJUSTE, 0, 0, False, None),
]
FISCAL_SALE_TYPE_NAMES = {"A": "Factura A", "B": "Factura B", "C": "Factura C"}

# Voiding: type prefix → mirror NC type prefix (seed-managed, rename-proof).
VOID_TYPE_MIRROR = {
    "FA": "NCV",
    "FB": "NCV",
    "FC": "NCV",
    "TCK": "NCV",
    "NDV": "NCV",
    "OC": "NCC",
    "NDC": "NCC",
}

SEED_MAIN_CASH_ACCOUNT = "Caja Principal"
SEED_CASH_PAYMENT_METHOD = "Efectivo"


def init_db(session: Session) -> None:
    # Tables should be created with Alembic migrations
    # But if you don't want to use migrations, create
    # the tables un-commenting the next lines
    # from sqlmodel import SQLModel

    # This works because the models are already imported and registered from app.models
    # SQLModel.metadata.create_all(engine)

    # --- Seed permissions ---
    for code, description in SEED_PERMISSIONS:
        existing = session.exec(
            select(Permission).where(Permission.code == code)
        ).first()
        if not existing:
            session.add(Permission(code=code, description=description))
    session.commit()

    # --- Seed "Administrador" role with all permissions ---
    admin_role = session.exec(select(Role).where(Role.name == "Administrador")).first()
    all_permissions = session.exec(select(Permission)).all()
    if not admin_role:
        admin_role = Role(
            name="Administrador",
            description="Full access to all system features",
        )
        session.add(admin_role)
        session.commit()
        session.refresh(admin_role)
        for perm in all_permissions:
            session.add(RolePermission(role_id=admin_role.id, permission_id=perm.id))
        session.commit()
    elif len(admin_role.permissions) != len(all_permissions):
        # Ensure the Admin role stays up-to-date with all permissions
        existing_perm_ids = {
            rp.permission_id
            for rp in session.exec(
                select(RolePermission).where(RolePermission.role_id == admin_role.id)
            ).all()
        }
        for perm in all_permissions:
            if perm.id not in existing_perm_ids:
                session.add(
                    RolePermission(role_id=admin_role.id, permission_id=perm.id)
                )
        session.commit()

    # --- Seed first superuser + assign Admin role ---
    user = session.exec(
        select(User).where(User.email == settings.FIRST_SUPERUSER)
    ).first()
    if not user:
        user_in = UserCreate(
            email=settings.FIRST_SUPERUSER,
            password=settings.FIRST_SUPERUSER_PASSWORD,
            is_superuser=True,
        )
        user = crud.create_user(session=session, user_create=user_in)

    if admin_role:
        existing_user_role = session.exec(
            select(UserRole).where(
                UserRole.user_id == user.id,
                UserRole.role_id == admin_role.id,
            )
        ).first()
        if not existing_user_role:
            session.add(UserRole(user_id=user.id, role_id=admin_role.id))
            session.commit()

    # --- Seed BusinessSettings singleton ---
    bs = session.exec(select(BusinessSettings)).first()
    if not bs:
        bs = BusinessSettings(
            business_name="My Business",
            condicion_fiscal=TaxCondition.CONSUMIDOR_FINAL,
        )
        session.add(bs)
        session.commit()

    # --- Seed UoM (only "unidad", the rest are user-created) ---
    if not session.exec(select(UoM).where(UoM.name == "unidad")).first():
        session.add(UoM(name="unidad", abbreviation="u", decimal_places=0))
        session.commit()

    # --- Seed Tax (IVA 21 / 10.5 / 27 / 0 / exento; IVA 21 is the default) ---
    seed_taxes: list[tuple[str, str, TaxType, str, bool, bool]] = [
        ("IVA 21%", "IVA21", TaxType.IVA, "21.00", True, True),
        ("IVA 10.5%", "IVA105", TaxType.IVA, "10.50", True, False),
        ("IVA 27%", "IVA27", TaxType.IVA, "27.00", True, False),
        ("IVA 0%", "IVA0", TaxType.IVA, "0.00", True, False),
        ("Exento", "EXENTO", TaxType.IVA, "0.00", False, False),
    ]
    for name, code, tipo, rate, is_percent, is_default in seed_taxes:
        if not session.exec(select(TaxModel).where(TaxModel.code == code)).first():
            session.add(
                TaxModel(
                    name=name,
                    code=code,
                    tipo=tipo,
                    rate=Decimal(rate),
                    is_percent=is_percent,
                    aplica_a=TaxAppliesTo.LINEA,
                    is_default=is_default,
                    is_active=True,
                )
            )
    session.commit()

    # Backfill: ensure the seeded default is flagged on pre-existing databases
    iva21 = session.exec(select(TaxModel).where(TaxModel.code == "IVA21")).first()
    if iva21 and not iva21.is_default:
        iva21.is_default = True
        session.add(iva21)
        session.commit()

    # --- Seed "Consumidor Final" default customer ---
    if not session.exec(
        select(Customer).where(Customer.razon_social == CONSUMIDOR_FINAL_NAME)
    ).first():
        session.add(
            Customer(
                razon_social=CONSUMIDOR_FINAL_NAME,
                condicion_fiscal=TaxCondition.CONSUMIDOR_FINAL,
            )
        )
        session.commit()

    # --- Seed document types ---
    for (
        name,
        prefix,
        operation,
        signo_stock,
        signo_caja,
        es_fiscal,
        party,
    ) in SEED_DOCUMENT_TYPES:
        if not session.exec(
            select(DocumentType).where(DocumentType.prefix == prefix)
        ).first():
            session.add(
                DocumentType(
                    name=name,
                    prefix=prefix,
                    operation=operation,
                    signo_stock=signo_stock,
                    signo_caja=signo_caja,
                    es_fiscal=es_fiscal,
                    tipo_contraparte=party,
                )
            )
    session.commit()

    # Wire the void-mirror NC type per voidable document type (idempotent).
    types_by_prefix = {t.prefix: t for t in session.exec(select(DocumentType)).all()}
    for type_prefix, mirror_prefix in VOID_TYPE_MIRROR.items():
        doc_type = types_by_prefix.get(type_prefix)
        mirror = types_by_prefix.get(mirror_prefix)
        if doc_type and mirror and doc_type.void_document_type_id != mirror.id:
            doc_type.void_document_type_id = mirror.id
            session.add(doc_type)
    session.commit()

    # --- Seed main cash account + cash payment method ---
    account = session.exec(
        select(FinancialAccount).where(FinancialAccount.name == SEED_MAIN_CASH_ACCOUNT)
    ).first()
    if not account:
        account = FinancialAccount(
            name=SEED_MAIN_CASH_ACCOUNT, tipo=FinancialAccountType.EFECTIVO
        )
        session.add(account)
        session.commit()
        session.refresh(account)
    if not session.exec(
        select(PaymentMethod).where(PaymentMethod.name == SEED_CASH_PAYMENT_METHOD)
    ).first():
        session.add(
            PaymentMethod(
                name=SEED_CASH_PAYMENT_METHOD,
                financial_account_id=account.id,
            )
        )
        session.commit()
