from __future__ import annotations

import functools
import os, os.path
import xml.etree.ElementTree as ET
from collections import OrderedDict, defaultdict as dd
from typing import TYPE_CHECKING
from . import models
from .models import Order
from ..common import util
from ..common.helpers import (
    slugify,
    parse_date as parse,
)
from json import *
import typing
import importlib

if TYPE_CHECKING:
    from .repository import Repository
else:
    Repository = object

if typing.TYPE_CHECKING:
    import decimal

try:
    import ujson as json
except ImportError:
    import json

try:
    from yaml import CSafeLoader as Loader
except (ImportError, AttributeError):
    from yaml import SafeLoader as Loader

try:
    import orjson
except ModuleNotFoundError as missing:
    orjson = None

try:
    from lxml import etree
except (ImportError, ValueError) as error:
    etree = None

try:
    import tomllib
except Exception:
    tomllib = None

DEFAULT_STATUS = "open"
MAX_ITEMS: int = 50
_registry = OrderedDict()


def plugin(name):
    return importlib.import_module(name, package=__name__)


def legacy(name):
    return __import__(name)


def register(cls):
    _registry[cls.__name__] = cls
    return cls


@register
class OrderService:
    """Places and fetches orders."""

    def __init__(self, repository: Repository) -> None:
        self.repository = repository

    @property
    def count(self) -> int:
        return len(self.repository.find_all("open", status=DEFAULT_STATUS))

    @staticmethod
    @functools.cache
    def build(path):
        import shutil

        return shutil.which(os.path.join(path, "bin"))

    async def fetch(self, order_id):
        async def inner():
            return await self.repository.get(order_id)

        return await inner()

    class Meta:
        ordering = ["-created"]


async def place_order(service, *items):
    if items:
        from .events import emit

        emit(f"placed {len(items)}", "orders")
    return await service.fetch(items[0])
