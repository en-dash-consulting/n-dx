/**
 * The hub's public OAuth callback page (hub/oauth-callback.ts): it forwards a
 * sign-in's return, query intact, to the project its state names, answers a
 * plain error page for an unknown or missing project, and reads nothing else.
 */

import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { answerOAuthCallback, type CallbackProjects } from "../../../src/hub/oauth-callback.js";
import { formatSignInState } from "../../../src/shared/index.js";

const NONCE = "n".repeat(43);
let server: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

/** A server answering only the callback, over `projects`; 418 for anything else. */
async function serve(ids: string[]): Promise<string> {
  const projects: CallbackProjects = { has: (id) => ids.includes(id), sole: () => (ids.length === 1 ? ids[0] : null) };
  server = createServer((req, res) => {
    if (!answerOAuthCallback(req, res, projects)) res.writeHead(418).end();
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}

const callback = (state: string, extra: Record<string, string> = {}) =>
  `/oauth/callback?${new URLSearchParams({ code: "the-code", state, iss: "https://as.example", ...extra })}`;

describe("hub OAuth callback", () => {
  it("forwards to /p/<project>/oauth/callback with the query intact, and sets nothing", async () => {
    const base = await serve(["alpha", "beta"]);
    const path = callback(formatSignInState({ project: "beta", workspace: "feat", connection: "docs", nonce: NONCE }));
    const res = await fetch(`${base}${path}`, { redirect: "manual", headers: { "X-Ndx-Token": "ignored", Cookie: "ndx_token=ignored" } });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/p/beta${path}`);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("forwards a return that names no project to the sole registered project", async () => {
    const base = await serve(["alpha"]);
    const path = callback(formatSignInState({ connection: "docs", nonce: NONCE }));
    const res = await fetch(`${base}${path}`, { redirect: "manual" });
    expect(res.headers.get("location")).toBe(`/p/alpha${path}`);
  });

  it("answers a plain error page for an unknown project, a missing one among several, or no state", async () => {
    const base = await serve(["alpha", "beta"]);
    for (const path of [
      callback(formatSignInState({ project: "gamma", connection: "docs", nonce: NONCE })),
      callback(formatSignInState({ connection: "docs", nonce: NONCE })),
      callback("not-a-state"),
      "/oauth/callback",
    ]) {
      const res = await fetch(`${base}${path}`, { redirect: "manual" });
      expect(res.status, path).toBe(404);
      expect(res.headers.get("content-type")).toContain("text/html");
      const body = await res.text();
      expect(body).toContain("Sign-in not finished");
      expect(body).not.toContain("the-code");
    }
  });

  it("answers only GET and HEAD, and only at the origin root's callback path", async () => {
    const base = await serve(["alpha"]);
    expect((await fetch(`${base}/oauth/callback`, { method: "POST" })).status).toBe(405);
    expect((await fetch(`${base}/p/alpha/oauth/callback`)).status).toBe(418);
    expect((await fetch(`${base}/oauth/callbacks`)).status).toBe(418);
  });
});
