import os
import urllib.request
from urllib.request import Request, urlopen

import aiohttp
import httpx as hx
import requests
from requests import Session

from app.config import settings

session = requests.Session()


def module_functions(item_id):
    requests.get("https://api.example.com/items")
    requests.post(url="https://api.example.com/items", json={})
    requests.request("PUT", "https://api.example.com/items/1")
    requests.delete(os.environ["ITEMS_URL"])
    requests.head(settings.STATUS_URL)
    requests.patch(f"{settings.API_BASE}/items/{item_id}")
    requests.options(f"https://api.example.com/items/{item_id}")
    requests.get("https://api.example.com" + "/health")
    requests.get(os.getenv("SEARCH_URL") + "/q")
    requests.get(BASE + "/x")
    requests.get(build_url(item_id))
    requests.get("")


def sessions():
    session.get("https://sessions.example.com/a")
    s = Session()
    s.post("https://sessions.example.com/b")
    with requests.Session() as scoped:
        scoped.put("https://sessions.example.com/c")


def httpx_calls():
    hx.get("https://httpx.example.com/a")
    hx.request("GET", url=settings.HTTPX_URL)
    client = hx.Client(base_url="https://httpx.example.com")
    client.patch("/b")
    hx.Client().delete("https://httpx.example.com/c")


async def async_calls():
    async with hx.AsyncClient() as c:
        await c.post("https://httpx.example.com/async")
    async with aiohttp.ClientSession() as http:
        async with http.get("https://aiohttp.example.com/a") as resp:
            await resp.text()
        await http.request("POST", "https://aiohttp.example.com/b")


def urllib_calls():
    urllib.request.urlopen("https://urllib.example.com/a")
    urlopen(Request("https://urllib.example.com/b"))
    req = Request(url="https://urllib.example.com/c")
    urlopen(req)


def not_clients(cache):
    # A bound client from another scope, an attribute receiver and a dict are not read.
    client.get("https://nowhere.example.com")
    cache.get("key")
    cache.session.get("https://nowhere.example.com")
    requests.get()
