import os
from os import environ, getenv

from django.conf import settings

DATABASE_URL = os.environ["DATABASE_URL"]
DEBUG = os.environ.get("DEBUG", "0")
SECRET = os.getenv("SECRET_KEY")
REGION = environ["REGION"]
ZONE = getenv("ZONE", "a")
NAME = os.environ.get(name_of_variable)

os.environ["WRITTEN"] = "1"
os.environ["COUNT"] += "1"
del os.environ["REMOVED"]
