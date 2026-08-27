from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import sentry_sdk
from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware

from app.api.main import api_router
from app.core.backup import run_scheduled_backups
from app.core.config import settings


def custom_generate_unique_id(route: APIRoute) -> str:
    return f"{route.tags[0]}-{route.name}"


if settings.SENTRY_DSN and settings.ENVIRONMENT != "local":
    sentry_sdk.init(dsn=str(settings.SENTRY_DSN), enable_tracing=True)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    # In-process scheduler: with multiple workers each process runs a tick,
    # but the job body takes a Postgres advisory lock so only one worker
    # actually runs the backup.
    scheduler = BackgroundScheduler()
    scheduler.add_job(
        run_scheduled_backups,
        trigger="interval",
        seconds=60,
        id="scheduled-backups",
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    generate_unique_id_function=custom_generate_unique_id,
    lifespan=lifespan,
)

# Set all CORS enabled origins
if settings.all_cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.all_cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(api_router, prefix=settings.API_V1_STR)

# Serve uploaded business assets (e.g. the logo shown on vouchers).
# check_dir=False: the directory may not exist yet on local dev hosts; the
# upload endpoint creates it on demand.
app.mount(
    "/uploads",
    StaticFiles(directory=settings.UPLOAD_DIR, check_dir=False),
    name="uploads",
)
