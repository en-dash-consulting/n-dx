from fastapi import APIRouter

router = APIRouter(prefix="/tools")


@router.get("/stats")
def stats():
    return {}
