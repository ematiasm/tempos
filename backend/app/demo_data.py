"""Opt-in demo data for the first-run setup flow.

Loaded by ``POST /setup`` when ``load_demo_data`` is true. Everything here is
additive and idempotent: rows that already exist (matched by name/code) are
skipped, and the caller owns the transaction (nothing is committed here).
"""

from decimal import Decimal

from sqlmodel import Session, select

from app.models import (
    Barcode,
    Category,
    Customer,
    Product,
    ProductTax,
    Supplier,
    Tax,
    TaxCondition,
    UoM,
)

DEMO_CATEGORIES: tuple[str, ...] = ("Almacén", "Bebidas", "Limpieza")

# (name, category, costo_actual, precio_venta, barcode)
# Prices are ARS; precio_venta carries IVA inside (project pricing convention).
DEMO_PRODUCTS: tuple[tuple[str, str, str, str, str], ...] = (
    ("Coca-Cola 2.25 L", "Bebidas", "3000", "4200", "7790001000019"),
    ("Coca-Cola 500 ml", "Bebidas", "1150", "1600", "7790001000026"),
    ("Sprite 500 ml", "Bebidas", "1080", "1500", "7790001000033"),
    ("Agua sin gas 2 L", "Bebidas", "850", "1200", "7790001000040"),
    ("Cerveza Quilmes 1 L", "Bebidas", "1900", "2600", "7790001000057"),
    ("Yerba Playadito 1 kg", "Almacén", "3800", "5200", "7790001000064"),
    ("Azúcar Ledesma 1 kg", "Almacén", "1000", "1400", "7790001000071"),
    ("Aceite girasol 900 ml", "Almacén", "1650", "2300", "7790001000088"),
    ("Fideos Canale 500 g", "Almacén", "850", "1200", "7790001000095"),
    ("Arroz Gallo 1 kg", "Almacén", "1450", "2000", "7790001000101"),
    ("Galletitas Oreo 118 g", "Almacén", "700", "1000", "7790001000118"),
    ("Alfajor Jorgito triple", "Almacén", "620", "900", "7790001000125"),
    ("Detergente Cif 750 ml", "Limpieza", "1350", "1900", "7790001000132"),
    ("Lavandina Ayudín 1 L", "Limpieza", "780", "1100", "7790001000149"),
)

DEMO_CUSTOMER_NAME = "Juan Pérez"
DEMO_SUPPLIER_NAME = "Distribuidora del Sur SRL"
# 30-prefixed company CUIT with a valid modulo-11 check digit (verified with
# the same algorithm as ``app.validators.normalize_and_validate_documento``).
DEMO_SUPPLIER_CUIT = "30622145010"


def _margin_pct(costo_actual: Decimal, precio_venta: Decimal) -> Decimal:
    """Margin percent implied by the given cost and IVA-inclusive sale price.

    Keeps ``margen_pct`` consistent with the project's pricing convention
    (``precio_venta = costo_actual * (1 + margen_pct / 100)``) so later cost
    updates recompute the same sale price.
    """
    return ((precio_venta / costo_actual - Decimal("1")) * Decimal("100")).quantize(
        Decimal("0.01")
    )


def load_demo_data(session: Session) -> None:
    """Add the demo catalog and counterparties to the session.

    Nothing is committed: the caller wraps everything in a single
    transaction. Products start with zero stock and no ``StockMovement``
    rows (stock is built through purchases/adjustments, never seeded).
    """
    # Unit of measure (seeded by init_db; recreate defensively if missing).
    uom = session.exec(select(UoM).where(UoM.name == "unidad")).first()
    if not uom:
        uom = UoM(name="unidad", abbreviation="u", decimal_places=0)
        session.add(uom)

    # Seeded default line tax for every demo product.
    iva21 = session.exec(select(Tax).where(Tax.code == "IVA21")).first()

    categories: dict[str, Category] = {}
    for category_name in DEMO_CATEGORIES:
        category = session.exec(
            select(Category).where(Category.name == category_name)
        ).first()
        if not category:
            category = Category(name=category_name)
            session.add(category)
        categories[category_name] = category

    for name, category_name, cost, price, barcode in DEMO_PRODUCTS:
        product = session.exec(select(Product).where(Product.name == name)).first()
        if not product:
            costo_actual = Decimal(cost)
            precio_venta = Decimal(price)
            product = Product(
                name=name,
                category_id=categories[category_name].id,
                uom_id=uom.id,
                costo_actual=costo_actual,
                margen_pct=_margin_pct(costo_actual, precio_venta),
                precio_venta=precio_venta,
            )
            session.add(product)
            if iva21 is not None:
                session.add(ProductTax(product_id=product.id, tax_id=iva21.id))
        if not session.exec(select(Barcode).where(Barcode.code == barcode)).first():
            session.add(Barcode(code=barcode, product_id=product.id))

    if not session.exec(
        select(Customer).where(Customer.razon_social == DEMO_CUSTOMER_NAME)
    ).first():
        session.add(
            Customer(
                razon_social=DEMO_CUSTOMER_NAME,
                condicion_fiscal=TaxCondition.CONSUMIDOR_FINAL,
            )
        )

    if not session.exec(
        select(Supplier).where(Supplier.razon_social == DEMO_SUPPLIER_NAME)
    ).first():
        session.add(
            Supplier(
                razon_social=DEMO_SUPPLIER_NAME,
                documento=DEMO_SUPPLIER_CUIT,
                condicion_fiscal=TaxCondition.RI,
            )
        )
