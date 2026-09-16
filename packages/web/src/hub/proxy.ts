/**
 * Reverse proxy from the hub to project servers.
 *
 * Two shapes of address reach a project:
 *
 * - `/p/<id>/…` — explicit. The prefix is stripped and the rest is forwarded
 *   to that project's server, so the server keeps seeing root-relative paths
 *   and every single-project assumption in it holds. The viewer served this
 *   way derives the same prefix from `location.pathname` and puts it back on
 *   everything it requests (see viewer/base-path.ts); the two use one helper
 *   in src/shared so they cannot disagree about where the prefix ends.
 * - root — the compatibility alias. With exactly one project registered,
 *   `/`, `/api/*`, `/data/*`, `/mcp/*` and the WebSocket upgrade all go to
 *   it unchanged, so a single-project user (and the existing e2e suites)
 *   notice nothing. With several, `/` answers with a plain project list (the
 *   home page proper is PR 9) and everything else is a 409 naming the ids —
 *   a request that could mean two different repositories must not be
 *   guessed at.
 *
 * Plain `node:http` and `node:net`: HTTP bodies stream in both directions;
 * a WebSocket upgrade is forwarded by writing the client's request head to
 * the upstream socket and piping the two sockets together.
 *
 * @module web/hub/proxy
 */

import { request as httpRequest } from "node:http";
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "node:http";
import { connect } from "node:net";
import type { Duplex } from "node:stream";
import { detectBasePath, projectIdFromBasePath, stripBasePath } from "../shared/index.js";
import type { Hub, ProjectView } from "./hub.js";

const UPSTREAM_HOST = "127.0.0.1";
/** Header telling the project server which prefix the client used, for anything that builds absolute links. */
const FORWARDED_PREFIX_HEADER = "x-forwarded-prefix";

/** What to do with a request that is not the hub's own API. */
export type ProxyDecision =
  | { kind: "proxy"; project: ProjectView; path: string; prefix: string }
  | { kind: "json"; status: number; body: unknown }
  | { kind: "html"; status: number; html: string };

/**
 * Decide where a request goes. Pure over the hub's project list, so the
 * routing rules are testable without sockets.
 *
 * @param upgrade true for a WebSocket upgrade — there is no page to serve, so
 *   the multi-project `/` case is a 409 rather than the project list.
 */
export function decideProxy(hub: Hub, url: string, upgrade = false): ProxyDecision {
  const queryIdx = url.indexOf("?");
  const pathname = queryIdx === -1 ? url : url.slice(0, queryIdx);
  const query = queryIdx === -1 ? "" : url.slice(queryIdx);

  const prefix = detectBasePath(pathname);
  if (prefix) {
    const id = projectIdFromBasePath(prefix) ?? "";
    const project = hub.getProject(id);
    if (!project) {
      return { kind: "json", status: 404, body: { error: `No project registered as "${id}"`, projects: projectIds(hub) } };
    }
    if (project.port === null) {
      return { kind: "json", status: 503, body: { error: `Project "${id}" has no running server`, status: project.status } };
    }
    return { kind: "proxy", project, path: stripBasePath(prefix, pathname) + query, prefix };
  }

  const projects = hub.listProjects();
  if (projects.length === 1) {
    const project = projects[0];
    if (project.port === null) {
      return { kind: "json", status: 503, body: { error: `Project "${project.id}" has no running server`, status: project.status } };
    }
    return { kind: "proxy", project, path: url, prefix: "" };
  }

  if (pathname === "/" && !upgrade) {
    return { kind: "html", status: 200, html: renderProjectList(projects) };
  }
  if (projects.length === 0) {
    return { kind: "json", status: 404, body: { error: "No project is registered with the hub", projects: [] } };
  }
  return {
    kind: "json",
    status: 409,
    body: {
      error: "Several projects are registered; address one as /p/<id>/…",
      projects: projects.map((p) => p.id),
    },
  };
}

function projectIds(hub: Hub): string[] {
  return hub.listProjects().map((p) => p.id);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
}

/** Minimal project list for `/` when the root alias is ambiguous. Replaced by the PR 9 home page. */
export function renderProjectList(projects: ProjectView[]): string {
  const items = projects.length === 0
    ? "<p>No project is registered. Run <code>ndx start</code> in a repository to register it.</p>"
    : `<ul>${projects
      .map((p) => `<li><a href="/p/${encodeURIComponent(p.id)}/">${escapeHtml(p.name)}</a> <code>${escapeHtml(p.repoRoot)}</code> — ${escapeHtml(p.status.state)}</li>`)
      .join("")}</ul>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>n-dx hub</title></head><body><h1>n-dx hub</h1>${items}</body></html>`;
}

/** Stream one HTTP request to a project server and its response back. */
export function proxyHttp(req: IncomingMessage, res: ServerResponse, port: number, path: string, prefix: string): void {
  const headers: OutgoingHttpHeaders = { ...req.headers, host: `${UPSTREAM_HOST}:${port}` };
  if (prefix) headers[FORWARDED_PREFIX_HEADER] = prefix;

  const upstream = httpRequest(
    { host: UPSTREAM_HOST, port, method: req.method, path, headers },
    (upstreamRes) => {
      const outHeaders = { ...upstreamRes.headers };
      // A redirect the project server issues is root-relative from its point
      // of view; the client is under the prefix.
      const location = outHeaders.location;
      if (prefix && typeof location === "string" && location.startsWith("/") && !location.startsWith("//")) {
        outHeaders.location = `${prefix}${location}`;
      }
      res.writeHead(upstreamRes.statusCode ?? 502, outHeaders);
      upstreamRes.pipe(res);
    },
  );

  upstream.on("error", (err) => {
    if (!res.headersSent) {
      const body = JSON.stringify({ error: `Project server unreachable: ${err.message}` });
      res.writeHead(502, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
      res.end(body);
    } else {
      res.destroy();
    }
  });
  req.on("aborted", () => upstream.destroy());
  req.pipe(upstream);
}

/** Forward a WebSocket upgrade: replay the request head upstream, then pipe both sockets. */
export function proxyUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  port: number,
  path: string,
  prefix: string,
): void {
  const upstream = connect(port, UPSTREAM_HOST);

  const fail = (): void => {
    if (socket.writable) {
      socket.write("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    }
    socket.destroy();
    upstream.destroy();
  };

  upstream.once("connect", () => {
    const lines = [`${req.method ?? "GET"} ${path} HTTP/${req.httpVersion || "1.1"}`];
    const raw = req.rawHeaders;
    for (let i = 0; i + 1 < raw.length; i += 2) {
      const name = raw[i];
      const value = raw[i + 1];
      lines.push(name.toLowerCase() === "host" ? `Host: ${UPSTREAM_HOST}:${port}` : `${name}: ${value}`);
    }
    if (prefix) lines.push(`X-Forwarded-Prefix: ${prefix}`);
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head.length > 0) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });

  upstream.once("error", fail);
  socket.once("error", () => upstream.destroy());
  socket.once("close", () => upstream.destroy());
  upstream.once("close", () => socket.destroy());
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}

/** Handle any request that is not `/api/hub/*`. Always responds. */
export function handleProxyRequest(req: IncomingMessage, res: ServerResponse, hub: Hub): void {
  const decision = decideProxy(hub, req.url || "/");
  switch (decision.kind) {
    case "proxy":
      proxyHttp(req, res, decision.project.port!, decision.path, decision.prefix);
      return;
    case "html":
      res.writeHead(decision.status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      res.end(decision.html);
      return;
    case "json":
      writeJson(res, decision.status, decision.body);
      return;
  }
}

/** Handle a WebSocket upgrade on the hub socket. */
export function handleProxyUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, hub: Hub): void {
  const decision = decideProxy(hub, req.url || "/", true);
  if (decision.kind === "proxy") {
    proxyUpgrade(req, socket, head, decision.project.port!, decision.path, decision.prefix);
    return;
  }
  const status = decision.kind === "json" ? decision.status : 404;
  const reason = status === 409 ? "Conflict" : status === 503 ? "Service Unavailable" : "Not Found";
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
