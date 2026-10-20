from celery import Celery

celery_app = Celery("app", broker="redis://redis:6379/0")


def schedule(name):
    celery_app.send_task("billing.charge", kwargs={"id": 1})
    celery_app.send_task(name)
