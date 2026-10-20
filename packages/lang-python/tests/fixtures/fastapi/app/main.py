from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app import legacy
from app.api.main import api_router
from app.core.config import settings

app = FastAPI(title="Shop")
app.include_router(api_router, prefix=settings.API_V1_STR)
app.include_router(make_router())
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/legacy", legacy.app)


@app.get("/health")
async def health():
    return {"ok": True}
