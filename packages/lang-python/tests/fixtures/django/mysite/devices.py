from . import routers
from .routers import device_router


class DeviceViewSet:
    pass


class CableViewSet:
    pass


device_router.register("devices", DeviceViewSet)
routers.device_router.register("cables", CableViewSet)
