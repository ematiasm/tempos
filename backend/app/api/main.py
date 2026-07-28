from fastapi import APIRouter

from app.api.routes import (
    attributes,
    business_settings,
    categories,
    customers,
    items,
    login,
    permissions,
    private,
    products,
    roles,
    suppliers,
    taxes,
    uoms,
    users,
    utils,
)
from app.core.config import settings

api_router = APIRouter()
api_router.include_router(login.router)
api_router.include_router(users.router)
api_router.include_router(roles.router)
api_router.include_router(permissions.router)
api_router.include_router(business_settings.router)
api_router.include_router(taxes.router)
api_router.include_router(categories.router)
api_router.include_router(uoms.router)
api_router.include_router(products.router)
api_router.include_router(attributes.router)
api_router.include_router(customers.router)
api_router.include_router(suppliers.router)
api_router.include_router(utils.router)
api_router.include_router(items.router)


if settings.ENVIRONMENT == "local":
    api_router.include_router(private.router)
