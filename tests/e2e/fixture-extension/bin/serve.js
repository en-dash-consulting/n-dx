// The sidecar the hub mounts at /x/fixture/. Listens on the loopback PORT the
// hub picks. `/healthz` is the manifest's health path, `/die` answers and then
// crashes, a WebSocket upgrade is answered with 101 and an echo, and anything
// else echoes the request and the process as JSON.
import { createServer } from "node:http";
import { recordLoad } from "../loaded.js";

recordLoad("serve");
const secret = process.env.NDX_SIDECAR_SECRET;
if (!secret) throw new Error("The hub must provide NDX_SIDECAR_SECRET");
process.stdin.resume();
process.stdin.on("end", () => process.exit(0));
const admitted = (req) => req.headers["x-ndx-sidecar-secret"] === secret;


const env = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("NDX_")));

const server = createServer((req, res) => {
  if (!admitted(req)) { res.writeHead(403).end("Forbidden"); return; }
  if (req.url === "/healthz") {
    res.writeHead(200);
    res.end("ok");
    return;
  }
  if (req.url === "/die") {
    res.writeHead(200);
    res.end("bye", () => process.exit(1));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ path: req.url, pid: process.pid, port: process.env.PORT, headers: req.headers, env: env() }));
});

server.on("upgrade", (req, socket) => {
  if (!admitted(req)) { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return; }
  const echo = JSON.stringify({ path: req.url, headers: req.headers });
  socket.end(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n${echo}`);
});

server.listen(Number(process.env.PORT), "127.0.0.1", () => {
  console.log(`fixture sidecar listening on ${process.env.PORT}`);
});
