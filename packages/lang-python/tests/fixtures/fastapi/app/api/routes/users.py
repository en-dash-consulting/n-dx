from fastapi import APIRouter

router = APIRouter()
cache = {}


@router.get("/me")
def me():
    return {}


@cache.get("/not-a-router")
def cached():
    return None
