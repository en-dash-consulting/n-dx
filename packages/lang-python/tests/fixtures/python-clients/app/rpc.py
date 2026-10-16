import grpc
from grpc import aio

from app.config import settings


def channels(credentials):
    grpc.insecure_channel("localhost:50051")
    grpc.secure_channel(settings.ORDERS_TARGET, credentials)
    grpc.aio.insecure_channel(target="inventory:50051")
    aio.secure_channel(f"{settings.PAYMENTS_HOST}:443", credentials)
