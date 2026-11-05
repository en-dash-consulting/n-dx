/**
 * `GET /oauth/callback` at the hub's origin root: the one public page the hub
 * answers itself.
 *
 * A connection sign-in returns to the fixed loopback callback n-dx's client
 * ID metadata document lists, so through the hub the authorization server
 * sends the browser to `http://127.0.0.1:3117/oauth/callback`, not to the
 * project's `/p/<id>/`. This page only forwards the browser, query intact,
 * to `/p/<project>/oauth/callback` for the project the state's routing field
 * names (shared/oauth-callback.ts), whose dashboard finishes the sign-in with
 * its own session. With no project in the state, the sole registered project
 * is the one (the root alias); otherwise, and for a project not registered,
 * it answers a plain error page.
 *
 * It reads no token, cookie or code and stores nothing: the state's project
 * is not a secret, and the request guard (Host, Origin) has run before it.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { OAUTH_CALLBACK_PATH, PROJECT_PATH_PREFIX, parseSignInState } from "../shared/index.js";

/** The projects the hub serves, as this page needs them. */
export interface CallbackProjects {
  has(id: string): boolean;
  /** The id of the only registered project, or null when there are none or several. */
  sole(): string | null;
}

function errorPage(res: ServerResponse, status: number, message: string): void {
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>Sign-in not finished</title></head>` +
    `<body><h1>Sign-in not finished</h1><p>${message}</p><p>Start the sign-in again from the project's Settings.</p></body></html>`;
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  res.end(body);
}

/** Answer `req` when it is the hub's OAuth callback; whether it was. */
export function answerOAuthCallback(req: IncomingMessage, res: ServerResponse, projects: CallbackProjects): boolean {
  const url = req.url || "/";
  const query = url.indexOf("?");
  const path = query === -1 ? url : url.slice(0, query);
  if (path !== OAUTH_CALLBACK_PATH) return false;
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD", "Cache-Control": "no-store" }).end();
    return true;
  }
  const search = query === -1 ? "" : url.slice(query);
  const state = parseSignInState(new URLSearchParams(search).get("state"));
  const project = state?.project ?? (state ? projects.sole() : null);
  if (!project || !projects.has(project)) {
    errorPage(res, 404, state?.project
      ? "This sign-in names a project the hub does not serve."
      : "This sign-in does not name a project the hub serves.");
    return true;
  }
  // The code and state ride along unread; the project's page finishes the sign-in.
  res.writeHead(302, {
    Location: `${PROJECT_PATH_PREFIX}${encodeURIComponent(project)}${OAUTH_CALLBACK_PATH}${search}`,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  res.end();
  return true;
}
