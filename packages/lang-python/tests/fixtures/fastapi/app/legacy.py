import fastapi

app = fastapi.FastAPI()


@app.api_route("/ping")
def ping():
    return "pong"
