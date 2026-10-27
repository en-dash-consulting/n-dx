import re
from datetime import date

__all__ = ["slugify"] + ["parse_" + "date"]


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower())


def parse_date(value):
    return date.fromisoformat(value)
