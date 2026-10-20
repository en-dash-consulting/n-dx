from fastapi import APIRouter

router = APIRouter(prefix="/items", tags=["items"])
ALLOWED = ["GET"]
VERSION = "v2"


@router.get("/")
def read_items():
    return []


@router.post("/")
def create_item():
    return {}


@router.put("/{id}")
def update_item(id: int):
    return {}


@router.delete("/{id}")
def delete_item(id: int):
    return None


@router.patch(path="/{id}")
def patch_item(id: int):
    return {}


@router.options("/")
def item_options():
    return None


@router.head("/")
def item_head():
    return None


@router.api_route("/bulk", methods=["PUT", "post"])
def bulk():
    return None


@router.api_route("/any")
def any_item():
    return None


@router.api_route("/dynamic", methods=ALLOWED)
def dynamic():
    return None


@router.get(f"/{VERSION}/latest")
def latest():
    return None


def not_a_route():
    router.get("/called-not-decorated")
