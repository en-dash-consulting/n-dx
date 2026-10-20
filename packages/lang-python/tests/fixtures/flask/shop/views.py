from flask import Blueprint

views = Blueprint("views", __name__)
PREFIX = "/old"


@views.route("/about")
def about():
    return "about"


@views.route("/login", methods=["GET", "POST"])
def login():
    return "login"


@views.route(rule="/feed", methods=("get",))
def feed():
    return "feed"


@views.get("/items/<int:id>")
def item(id):
    return "item"


@views.post("/items")
def add_item():
    return "added"


@views.put("/items/<int:id>")
def put_item(id):
    return "put"


@views.delete("/items/<int:id>")
def delete_item(id):
    return "deleted"


@views.patch("/items/<int:id>")
def patch_item(id):
    return "patched"


@views.route(PREFIX + "/redirect")
def old_redirect():
    return "moved"
