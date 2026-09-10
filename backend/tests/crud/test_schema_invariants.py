"""Database-level invariants that migrations establish and route code relies on.

These backstops are invisible to a reader of the route handlers but load-bearing
for their error handling, and losing one degrades a friendly error into a 500 with
no test failure. Migration ``39c9148ae5e4`` restored two of them after
``d61ddf38636a`` dropped both by accident, so each object gets a behavioral test
here: if it disappears again, these fail instead of the code silently degrading.

The cash-session guard is covered from the route side in
``tests/api/routes/test_cash_sessions.py``, where its fixture already provides the
open session.
"""

from decimal import Decimal

import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.models import Product, UoM
from tests.utils.utils import random_lower_string


def test_stock_maximo_check_rejects_inverted_bounds(db: Session) -> None:
    """``stock_maximo >= stock_minimo`` holds even for writes that skip the routes.

    The product routes reject an inverted min-max pair (``_ensure_stock_maximo``),
    but imports, scripts and direct SQL bypass them. Without the database check the
    flush below succeeds and this test fails, which is the point: the constraint is
    the only guard for those paths.
    """
    uom = UoM(name=random_lower_string()[:10], abbreviation="ZB", decimal_places=0)
    db.add(uom)
    db.flush()
    product = Product(
        name=random_lower_string()[:20],
        uom_id=uom.id,
        margen_pct=Decimal("0"),
        costo_actual=Decimal("0"),
        stock_minimo=Decimal("10"),
        stock_maximo=Decimal("5"),
    )
    db.add(product)
    with pytest.raises(IntegrityError) as excinfo:
        db.flush()
    db.rollback()
    # Pin the failure to this constraint, not to any other one that happens to fire.
    assert "ck_product_stock_maximo_gte_minimo" in str(excinfo.value)
