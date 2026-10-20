from fastapi import APIRouter

from app.api.routes import items, users as people
from .routes.admin import router as admin_router

api_router = APIRouter()
api_router.include_router(items.router)
api_router.include_router(people.router, prefix="/people")
# The same router mounted twice: both paths.
api_router.include_router(admin_router, prefix="/admin")
api_router.include_router(admin_router, prefix="/staff")
