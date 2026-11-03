/**
 * The page half of the browser credential (see `auth.ts`).
 *
 * Every HTML document a token-protected server sends — the dashboard shell,
 * the landing page, the hub home page, the preview — gets
 * {@link BROWSER_SESSION_SCRIPT} as its first script ({@link injectSessionScript}).
 * One copy of the logic for every page, including the two that are rendered
 * as strings and cannot import a bundle. It:
 *
 * 1. exchanges a `?ndx_nonce=` in the address for a session credential
 *    (`POST /api/auth/session`), keeps that in `sessionStorage`, and takes the
 *    nonce out of the address bar;
 * 2. without a credential, asks the other tabs of this origin for theirs over
 *    a `BroadcastChannel` — so a link opened in a new tab, or a deep link
 *    pasted while the dashboard is open, signs itself in;
 * 3. wraps `fetch` so every same-origin request carries the credential as
 *    `X-Ndx-Token`;
 * 4. asks `GET /api/auth/state` whether that is enough, and otherwise replaces
 *    the page with "open the URL `ndx start` printed";
 * 5. exposes `window.ndxAuth` — `ready` (a promise of `{ ok }`), and
 *    `socketUrl(url)`, which fetches a single-use ticket and returns the
 *    WebSocket URL carrying it.
 *
 * A plain string, not a bundled module: it has to run in pages that are
 * server-rendered strings. Tested by evaluating it (tests/unit/shared/
 * browser-session.test.ts).
 */

import { AUTH_ROUTES, NONCE_QUERY_PARAM, SESSION_STORAGE_KEY, TICKET_QUERY_PARAM } from "./auth.js";

export const BROWSER_SESSION_SCRIPT = `
(function () {
  if (window.ndxAuth) return;
  var KEY = ${JSON.stringify(SESSION_STORAGE_KEY)};
  var NONCE = ${JSON.stringify(NONCE_QUERY_PARAM)};
  var TICKET = ${JSON.stringify(TICKET_QUERY_PARAM)};
  var STATE = ${JSON.stringify(AUTH_ROUTES.state)};
  var SESSION = ${JSON.stringify(AUTH_ROUTES.session)};
  var WS_TICKET = ${JSON.stringify(AUTH_ROUTES.wsTicket)};
  var CHANNEL = "ndx-auth";

  function get() { try { return sessionStorage.getItem(KEY); } catch (e) { return null; } }
  function set(v) { try { sessionStorage.setItem(KEY, v); } catch (e) { /* storage blocked */ } }
  function clear() { try { sessionStorage.removeItem(KEY); } catch (e) { /* storage blocked */ } }

  var baseFetch = window.fetch.bind(window);

  function isSameOrigin(input) {
    try {
      var raw = typeof input === "string" ? input : (input && input.url) || String(input);
      return new URL(raw, location.href).origin === location.origin;
    } catch (e) { return false; }
  }

  var shown = false;
  function showRequired(reason) {
    if (shown) return;
    shown = true;
    var lead = reason === "expired"
      ? "This sign-in link has expired or was already used."
      : reason === "ended"
        ? "This session has ended — the server was restarted, or the session expired."
        : "This n-dx server only answers the browser tab that opened the link <code>ndx start</code> printed.";
    var html = '<main style="font:15px/1.5 system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem">'
      + '<h1>Sign-in needed</h1><p>' + lead + '</p>'
      + '<p>Run <code>ndx start</code> in the project again and open the URL it prints. '
      + 'The link works once, for about a minute; the tab it opens stays signed in, and so do tabs opened from it while it is open.</p></main>';
    function paint() { document.body.innerHTML = html; }
    if (document.body) paint(); else document.addEventListener("DOMContentLoaded", paint);
  }

  window.fetch = function (input, init) {
    var credential = get();
    if (!credential || !isSameOrigin(input)) return baseFetch(input, init);
    var headers = new Headers((init && init.headers) || (input && typeof input !== "string" && input.headers) || undefined);
    if (!headers.has("X-Ndx-Token") && !headers.has("Authorization")) headers.set("X-Ndx-Token", credential);
    var next = {};
    if (init) for (var k in init) next[k] = init[k];
    next.headers = headers;
    return baseFetch(input, next).then(function (res) {
      if (res.status === 401 && get() === credential && (res.headers.get("WWW-Authenticate") || "").indexOf("n-dx") !== -1) {
        clear();
        showRequired("ended");
      }
      return res;
    });
  };

  var channel = null;
  try { channel = new BroadcastChannel(CHANNEL); } catch (e) { channel = null; }
  if (channel) {
    channel.onmessage = function (event) {
      var data = event.data || {};
      if (data.type === "request") {
        var credential = get();
        if (credential) channel.postMessage({ type: "credential", value: credential });
      }
    };
  }

  function askOtherTabs() {
    if (!channel) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var done = false;
      var listener = function (event) {
        var data = event.data || {};
        if (!done && data.type === "credential" && typeof data.value === "string") {
          done = true;
          channel.removeEventListener("message", listener);
          resolve(data.value);
        }
      };
      channel.addEventListener("message", listener);
      channel.postMessage({ type: "request" });
      setTimeout(function () {
        if (done) return;
        done = true;
        channel.removeEventListener("message", listener);
        resolve(null);
      }, 300);
    });
  }

  function stripNonce() {
    var url = new URL(location.href);
    var nonce = url.searchParams.get(NONCE);
    if (nonce === null) return null;
    url.searchParams.delete(NONCE);
    try { history.replaceState(history.state, "", url.pathname + url.search + url.hash); } catch (e) { /* keep going */ }
    return nonce;
  }

  function establish() {
    var linkFailed = false;
    var nonce = stripNonce();
    var step = Promise.resolve();
    if (nonce) {
      step = baseFetch(SESSION, { method: "POST", headers: { "X-Ndx-Nonce": nonce }, cache: "no-store" })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (body) {
          if (body && typeof body.credential === "string") set(body.credential);
          else linkFailed = true;
        })
        .catch(function () { linkFailed = true; });
    }
    return step
      .then(function () {
        if (get()) return null;
        return askOtherTabs().then(function (value) { if (value) set(value); });
      })
      .then(function () {
        var credential = get();
        return baseFetch(STATE, { cache: "no-store", headers: credential ? { "X-Ndx-Token": credential } : {} });
      })
      .then(function (res) { return res.ok ? res.json() : { required: false, authenticated: true }; })
      .then(function (state) {
        if (state.required && !state.authenticated) {
          clear();
          showRequired(linkFailed ? "expired" : "missing");
          return { ok: false };
        }
        return { ok: true };
      })
      .catch(function () { return { ok: true }; });
  }

  function socketUrl(url) {
    if (!get()) return Promise.resolve(url);
    return window.fetch(WS_TICKET, { method: "POST", cache: "no-store" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (body) {
        if (!body || typeof body.ticket !== "string") return url;
        var u = new URL(url, location.href);
        u.searchParams.set(TICKET, body.ticket);
        return u.toString();
      })
      .catch(function () { return url; });
  }

  window.ndxAuth = { ready: establish(), socketUrl: socketUrl, credential: get };
})();
`;

/**
 * Put {@link BROWSER_SESSION_SCRIPT} at the top of `html`'s `<head>` (or
 * first, when there is no head), so it runs before any script of the page's
 * own and its `fetch` wrapper is the one every later request goes through.
 */
export function injectSessionScript(html: string): string {
  const tag = `<script>${BROWSER_SESSION_SCRIPT}</script>`;
  const head = /<head[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length);
  return tag + html;
}
