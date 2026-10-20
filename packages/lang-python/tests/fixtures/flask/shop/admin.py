from flask import Blueprint

bp = Blueprint("admin", __name__, url_prefix="/admin")
reports = Blueprint("reports", __name__, url_prefix="/reports")
bp.register_blueprint(reports)


@bp.route("/")
def dashboard():
    return "dashboard"


@reports.route("/daily", methods=["GET", "DELETE"])
def daily():
    return "daily"
