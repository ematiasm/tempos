from collections.abc import Generator
from dataclasses import dataclass
from typing import Annotated, Any

import jwt
from fastapi import Depends, HTTPException, Query, status
from fastapi.security import OAuth2PasswordBearer
from jwt.exceptions import InvalidTokenError
from pydantic import ValidationError
from sqlmodel import Session, col, select

from app.core import security
from app.core.config import settings
from app.core.db import engine
from app.models import Permission, RolePermission, TokenPayload, User, UserRole

reusable_oauth2 = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/login/access-token"
)


def get_db() -> Generator[Session]:
    with Session(engine) as session:
        yield session


SessionDep = Annotated[Session, Depends(get_db)]
TokenDep = Annotated[str, Depends(reusable_oauth2)]


@dataclass
class PaginationParams:
    """Reusable pagination query params with validated bounds.

    Inject as `pagination: PaginationDep` and use `pagination.skip` / `pagination.limit`.
    """

    skip: int = Query(default=0, ge=0, description="Items to skip")
    limit: int = Query(default=100, ge=1, le=1000, description="Items per page")


PaginationDep = Annotated[PaginationParams, Depends()]


def get_current_user(session: SessionDep, token: TokenDep) -> User:
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[security.ALGORITHM]
        )
        token_data = TokenPayload(**payload)
    except InvalidTokenError, ValidationError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Could not validate credentials",
        )
    user = session.get(User, token_data.sub)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_current_active_superuser(current_user: CurrentUser) -> User:
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=403, detail="The user doesn't have enough privileges"
        )
    return current_user


def require_permissions(*permission_codes: str) -> Any:
    """FastAPI dependency factory that checks the current user has at least one
    of the given permission codes through any of their assigned roles.

    Superusers bypass the check for backward compatibility with the template.
    """

    def dependency(current_user: CurrentUser, session: SessionDep) -> User:
        if current_user.is_superuser:
            return current_user
        statement = (
            select(Permission.code)
            .join(
                RolePermission,
                col(RolePermission.permission_id) == Permission.id,
            )
            .join(
                UserRole,
                col(UserRole.role_id) == col(RolePermission.role_id),
            )
            .where(col(UserRole.user_id) == current_user.id)
        )
        user_permissions: set[str] = set(session.exec(statement).all())
        if not any(code in user_permissions for code in permission_codes):
            raise HTTPException(
                status_code=403,
                detail="The user doesn't have enough privileges",
            )
        return current_user

    return Depends(dependency)
