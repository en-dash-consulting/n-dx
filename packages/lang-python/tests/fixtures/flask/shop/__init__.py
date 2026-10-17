from flask import Flask

from shop import api
from shop.admin import bp as admin_bp
from .views import views


def create_app():
    app = Flask(__name__)
    app.register_blueprint(views)
    app.register_blueprint(admin_bp)
    # A registration's url_prefix replaces the blueprint's own.
    app.register_blueprint(api.bp, url_prefix="/api/v2")
    app.register_blueprint(missing_bp)

    @app.route("/")
    def index():
        return "home"

    return app
