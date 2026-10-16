import requests

session = requests.Session()


def parameter(session):
    session.get("https://shadow.example.com/parameter")


def keyword_only(*, session=None):
    session.get("https://shadow.example.com/keyword")


def local_call():
    session = make_other()
    session.get("https://shadow.example.com/local")


def bound_after_use():
    session.get("https://shadow.example.com/before")
    for session in pool():
        pass


def imported():
    from app.other import session
    session.get("https://shadow.example.com/imported")


def walrus(items):
    [item for item in items if (session := pick(item))]
    session.get("https://shadow.example.com/walrus")


def module_client(urls):
    session.get("https://shadow.example.com/module")
    [session.get(url) for url in urls]
    [session.get(url) for session, url in urls]
    handler = lambda session: session.get("https://shadow.example.com/lambda")


def declared_global():
    global session
    session.get("https://shadow.example.com/global")


def outer():
    client = requests.Session()

    def inner():
        client.get("https://shadow.example.com/enclosing")

    def rebinds(client):
        client.get("https://shadow.example.com/rebinds")

    def declared_nonlocal():
        nonlocal client
        client.get("https://shadow.example.com/nonlocal")


class Handler:
    session = make_other()

    def method(self):
        session.get("https://shadow.example.com/method")


def bound_from_itself():
    channel = channel.channel()
    channel.basic_publish(exchange="", routing_key="loop")


pool_session = requests.Session()


def reset_pool():
    global pool_session
    pool_session = make_other()


def uses_pool():
    pool_session.get("https://shadow.example.com/pool")


def outer_rebound():
    shared = requests.Session()

    def rebind():
        nonlocal shared
        shared = make_other()

    shared.get("https://shadow.example.com/shared")
