from decimal import Decimal
from typing import NamedTuple

from sqlmodel import Session, create_engine, select

from app import crud
from app.core.config import settings
from app.models import (
    CounterpartType,
    DocumentOperation,
    DocumentType,
    FinancialAccount,
    PaymentMethod,
    Permission,
    Role,
    RolePermission,
    TaxAppliesTo,
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
    ("cost.read", "View supplier costs"),
    ("cost.create", "Register supplier costs"),
    ("cost.update", "Update supplier costs"),
    ("cost.delete", "Delete supplier costs"),
    ("document.read", "View documents"),
    ("document.create", "Create documents"),
    ("document.void", "Void documents"),
    ("document.email", "Send document vouchers by email"),
    ("payment.read", "View receipts and outstanding documents"),
    ("payment.create", "Register payments (receipts)"),
    ("stock.read", "View stock movements"),
    ("stock.adjust", "Adjust stock"),
    ("finance.read", "View financial accounts"),
    ("finance.create", "Create financial transactions"),
    ("finance.update", "Update financial transactions"),
    ("transfer.create", "Create internal transfers"),
    ("cash.read", "View cash sessions and closing reports"),
    ("cash.open", "Open a daily cash session"),
    ("cash.close", "Close a daily cash session"),
    ("report.view", "View reports"),
    ("backup.read", "View backups and backup schedule"),
    ("backup.create", "Create backups"),
    ("backup.delete", "Delete backups"),
    ("backup.schedule", "Configure the backup schedule"),
    ("backup.restore", "Restore the database from a backup"),
]


class _SeedDocumentType(NamedTuple):
    """A seeded document type, named so the positional booleans stop being opaque."""

    # Stable identity used by code. `name` and `prefix` are editable afterwards,
    # so neither of them may ever be used to resolve a seeded type.
    key: str
    name: str
    prefix: str
    operation: DocumentOperation
    signo_stock: int
    signo_caja: int
    es_fiscal: bool
    tipo_contraparte: CounterpartType | None


# Seeded document types. Signs: stock/caja direction of the operation.
SEED_DOCUMENT_TYPES: list[_SeedDocumentType] = [
    _SeedDocumentType(
        "factura_a",
        "Factura A",
        "FA",
        DocumentOperation.VENTA,
        -1,
        +1,
        True,
        CounterpartType.CUSTOMER,
    ),
    _SeedDocumentType(
        "factura_b",
        "Factura B",
        "FB",
        DocumentOperation.VENTA,
        -1,
        +1,
        True,
        CounterpartType.CUSTOMER,
    ),
    _SeedDocumentType(
        "factura_c",
        "Factura C",
        "FC",
        DocumentOperation.VENTA,
        -1,
        +1,
        True,
        CounterpartType.CUSTOMER,
    ),
    _SeedDocumentType(
        "ticket",
        "Ticket",
        "TCK",
        DocumentOperation.VENTA,
        -1,
        +1,
        False,
        CounterpartType.CUSTOMER,
    ),
    _SeedDocumentType(
        "cotizacion",
        "Cotización",
        "COT",
        DocumentOperation.COTIZACION,
        0,
        0,
        False,
        CounterpartType.CUSTOMER,
    ),
    _SeedDocumentType(
        "nota_credito_venta",
        "Nota de Crédito",
        "NCV",
        DocumentOperation.VENTA,
        +1,
        -1,
        True,
        CounterpartType.CUSTOMER,
    ),
    _SeedDocumentType(
        "nota_debito_venta",
        "Nota de Débito",
        "NDV",
        DocumentOperation.VENTA,
        -1,
        +1,
        True,
        CounterpartType.CUSTOMER,
    ),
    _SeedDocumentType(
        "orden_compra",
        "Orden de Compra",
        "OC",
        DocumentOperation.COMPRA,
        +1,
        -1,
        False,
        CounterpartType.SUPPLIER,
    ),
    _SeedDocumentType(
        "nc_compra",
        "NC Compra",
        "NCC",
        DocumentOperation.COMPRA,
        -1,
        +1,
        False,
        CounterpartType.SUPPLIER,
    ),
    _SeedDocumentType(
        "nd_compra",
        "ND Compra",
        "NDC",
        DocumentOperation.COMPRA,
        +1,
        -1,
        False,
        CounterpartType.SUPPLIER,
    ),
    _SeedDocumentType(
        "remito",
        "Remito",
        "RTO",
        DocumentOperation.VENTA,
        -1,
        0,
        False,
        CounterpartType.CUSTOMER,
    ),
    _SeedDocumentType(
        "ajuste_stock",
        "Ajuste Stock",
        "AJS",
        DocumentOperation.AJUSTE,
        0,
        0,
        False,
        None,
    ),
    _SeedDocumentType(
        "recibo_cobro",
        "Recibo de Cobro",
        "RC",
        DocumentOperation.RECIBO,
        0,
        +1,
        False,
        CounterpartType.CUSTOMER,
    ),
    _SeedDocumentType(
        "recibo_pago",
        "Recibo de Pago",
        "RP",
        DocumentOperation.RECIBO,
        0,
        -1,
        False,
        CounterpartType.SUPPLIER,
    ),
]
# Voiding: type key → mirror NC type key (seed-managed, rename-proof).
VOID_TYPE_MIRROR = {
    "factura_a": "nota_credito_venta",
    "factura_b": "nota_credito_venta",
    "factura_c": "nota_credito_venta",
    "ticket": "nota_credito_venta",
    "nota_debito_venta": "nota_credito_venta",
    "orden_compra": "nc_compra",
    "nd_compra": "nc_compra",
}

SEED_MAIN_CASH_ACCOUNT = "Caja Principal"
SEED_CASH_PAYMENT_METHOD = "Efectivo"
SEED_CREDIT_ACCOUNT = "Crédito"
SEED_CREDIT_PAYMENT_METHOD = "Crédito"


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

    # NOTE: the BusinessSettings singleton and the "Consumidor Final" default
    # customer are NOT seeded here anymore: the system is "not configured"
    # until a BusinessSettings row exists (first-run /setup flow).

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

    # --- Seed document types ---
    # Matched by the stable `key`, never by `prefix`: the prefix is editable from
    # the admin panel, so a rename used to make the next startup believe the type
    # was missing and insert a duplicate. A database that predates the `key`
    # column still has NULLs here, so the current prefix and then the current name
    # are used to adopt the row before falling back to an insert.
    for seed in SEED_DOCUMENT_TYPES:
        doc_type = session.exec(
            select(DocumentType).where(DocumentType.key == seed.key)
        ).first()
        if doc_type is None:
            doc_type = session.exec(
                select(DocumentType).where(DocumentType.prefix == seed.prefix)
            ).first()
        if doc_type is None:
            doc_type = session.exec(
                select(DocumentType).where(DocumentType.name == seed.name)
            ).first()
        if doc_type is None:
            session.add(
                DocumentType(
                    key=seed.key,
                    name=seed.name,
                    prefix=seed.prefix,
                    operation=seed.operation,
                    signo_stock=seed.signo_stock,
                    signo_caja=seed.signo_caja,
                    es_fiscal=seed.es_fiscal,
                    tipo_contraparte=seed.tipo_contraparte,
                )
            )
        elif doc_type.key != seed.key:
            doc_type.key = seed.key
            session.add(doc_type)
    session.commit()

    # Wire the void-mirror NC type per voidable document type (idempotent).
    types_by_key = {
        t.key: t for t in session.exec(select(DocumentType)).all() if t.key is not None
    }
    for type_key, mirror_key in VOID_TYPE_MIRROR.items():
        doc_type = types_by_key.get(type_key)
        mirror = types_by_key.get(mirror_key)
        if doc_type and mirror and doc_type.void_document_type_id != mirror.id:
            doc_type.void_document_type_id = mirror.id
            session.add(doc_type)
    session.commit()

    # --- Seed main cash account + cash payment method ---
    account = session.exec(
        select(FinancialAccount).where(FinancialAccount.name == SEED_MAIN_CASH_ACCOUNT)
    ).first()
    if not account:
        account = FinancialAccount(name=SEED_MAIN_CASH_ACCOUNT)
        session.add(account)
        session.commit()
        session.refresh(account)
    cash_method = session.exec(
        select(PaymentMethod).where(PaymentMethod.name == SEED_CASH_PAYMENT_METHOD)
    ).first()
    if not cash_method:
        session.add(
            PaymentMethod(
                name=SEED_CASH_PAYMENT_METHOD,
                financial_account_id=account.id,
                is_cash_drawer=True,
            )
        )
    elif not cash_method.is_cash_drawer:
        # Backfill on pre-existing databases: the cash method feeds the drawer.
        cash_method.is_cash_drawer = True
        session.add(cash_method)
    session.commit()

    # --- Seed the current-account (credit) account + payment method ---
    # Credit payments never mark documents as paid and generate no account
    # movement: the amount stays in the counterpart's balance delta.
    credit_account = session.exec(
        select(FinancialAccount).where(FinancialAccount.name == SEED_CREDIT_ACCOUNT)
    ).first()
    if not credit_account:
        credit_account = FinancialAccount(name=SEED_CREDIT_ACCOUNT)
        session.add(credit_account)
        session.commit()
        session.refresh(credit_account)
    if not session.exec(
        select(PaymentMethod).where(PaymentMethod.name == SEED_CREDIT_PAYMENT_METHOD)
    ).first():
        session.add(
            PaymentMethod(
                name=SEED_CREDIT_PAYMENT_METHOD,
                financial_account_id=credit_account.id,
                marks_paid=False,
            )
        )
        session.commit()
