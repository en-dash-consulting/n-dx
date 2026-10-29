import { describe, expect, it } from "vitest";
import {
  AUTH_ROUTES,
  CredentialStore,
  answerAuthRoute,
  authRouteOf,
  authorizeUpgrade,
  isAuthenticated,
  presentedToken,
  randomCredential,
  requestAccess,
  splitQueryParam,
  removeTokenParam,
  splitTokenQuery,
  tokensEqual,
  urlWithNonce,
} from "../../../src/shared/auth.js";

const T = "abc123-XYZ_token";

it("removes nonce parameters while preserving unrelated query bytes", () => {
  const rest = "space=%20value&bare&path=/a~b&invalid=%E9";
  expect(splitQueryParam(`/p/test/?${rest}&ndx_nonce=N`, "ndx_nonce")).toEqual({ value: "N", url: `/p/test/?${rest}` });
});

describe("tokensEqual", () => {
  it("matches only the exact token", () => {
    expect(tokensEqual(T, T)).toBe(true);
    expect(tokensEqual(T + "x", T)).toBe(false);
    expect(tokensEqual(T.slice(0, -1), T)).toBe(false);
    expect(tokensEqual("", T)).toBe(false);
    expect(tokensEqual(null, T)).toBe(false);
    expect(tokensEqual(undefined, T)).toBe(false);
  });
});

describe("presentedToken", () => {
  it("reads the bearer header, then X-Ndx-Token", () => {
    expect(presentedToken({ authorization: `Bearer ${T}` })).toBe(T);
    expect(presentedToken({ authorization: `bearer   ${T}  ` })).toBe(T);
    expect(presentedToken({ "x-ndx-token": ` ${T} ` })).toBe(T);
  });

  it("ignores a non-bearer Authorization, a duplicated header, and any cookie", () => {
    expect(presentedToken({ authorization: "Basic abc" })).toBeNull();
    expect(presentedToken({ "x-ndx-token": [T, T] })).toBeNull();
    // A cookie on localhost reaches every port on it, so none is read.
    expect(presentedToken({ cookie: `ndx_token=${T}` } as never)).toBeNull();
    expect(presentedToken({})).toBeNull();
  });

  it("isAuthenticated takes the per-user token from a header only", () => {
    expect(isAuthenticated({ "x-ndx-token": T }, T)).toBe(true);
    expect(isAuthenticated({ "x-ndx-token": `${T}x` }, T)).toBe(false);
    expect(isAuthenticated({ cookie: `ndx_token=${T}` } as never, T)).toBe(false);
  });
});

describe("randomCredential", () => {
  it("is 256 bits of base64url and never repeats", () => {
    const a = randomCredential();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomCredential()).not.toBe(a);
  });
});

describe("CredentialStore", () => {
  function clocked() {
    let now = 1_000;
    const store = new CredentialStore({ now: () => now, nonceTtlMs: 60_000, ticketTtlMs: 30_000, sessionIdleTtlMs: 1_000, sessionMaxTtlMs: 5_000 });
    return { store, advance: (ms: number) => { now += ms; } };
  }

  it("exchanges a nonce for a session once", () => {
    const { store } = clocked();
    const { nonce } = store.mintNonce();
    const session = store.exchangeNonce(nonce);
    expect(session?.credential).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(session?.credential).not.toBe(nonce);
    expect(store.exchangeNonce(nonce)).toBeNull();
    expect(store.isSession(session!.credential)).toBe(true);
    expect(store.isSession(nonce)).toBe(false);
  });

  it("refuses an expired nonce", () => {
    const { store, advance } = clocked();
    const { nonce } = store.mintNonce();
    advance(60_001);
    expect(store.exchangeNonce(nonce)).toBeNull();
  });

  it("ends a session after its idle time, and after its hard limit however busy", () => {
    const { store, advance } = clocked();
    const idle = store.exchangeNonce(store.mintNonce().nonce)!.credential;
    advance(1_001);
    expect(store.isSession(idle)).toBe(false);

    const busy = store.exchangeNonce(store.mintNonce().nonce)!.credential;
    for (let i = 0; i < 5; i++) {
      advance(900);
      expect(store.isSession(busy)).toBe(true);
    }
    advance(900);
    expect(store.isSession(busy)).toBe(false);
  });

  it("spends a ticket once, and not after it expires", () => {
    const { store, advance } = clocked();
    const { ticket } = store.mintTicket();
    expect(store.consumeTicket(ticket)).toBe(true);
    expect(store.consumeTicket(ticket)).toBe(false);
    const late = store.mintTicket().ticket;
    advance(30_001);
    expect(store.consumeTicket(late)).toBe(false);
  });

  it("revokeAll forgets everything", () => {
    const { store } = clocked();
    const session = store.exchangeNonce(store.mintNonce().nonce)!.credential;
    store.revokeAll();
    expect(store.isSession(session)).toBe(false);
  });

  it("keeps each kind under its cap", () => {
    const store = new CredentialStore({ maxEntries: 2 });
    const first = store.mintTicket().ticket;
    store.mintTicket();
    store.mintTicket();
    expect(store.consumeTicket(first)).toBe(false);
  });

  it("keeps every other query segment byte for byte", () => {
    const rest = "a=%20b&c&path=/a/b~c&cb=%E9&d=x+y";
    expect(splitTokenQuery(`/prd?${rest}&ndx_token=${T}`)).toEqual({ token: T, location: `/prd?${rest}` });
  });
});

describe("removeTokenParam", () => {
  it("returns the first token, decoded, and the other segments unchanged", () => {
    expect(removeTokenParam(`a=%20b&ndx_token=${T}&c&cb=%E9`)).toEqual({ token: T, rest: "a=%20b&c&cb=%E9" });
    expect(removeTokenParam("ndx_token=a%2Bb&ndx%5Ftoken=second")).toEqual({ token: "a+b", rest: "" });
  });

  it("returns the query unchanged when there is no token", () => {
    expect(removeTokenParam("a=%20b&&c")).toEqual({ token: null, rest: "a=%20b&&c" });
    expect(removeTokenParam("")).toEqual({ token: null, rest: "" });
  });
});

describe("requestAccess", () => {
  it("tells the token, a session and nothing apart", () => {
    const store = new CredentialStore();
    const session = store.exchangeNonce(store.mintNonce().nonce)!.credential;
    expect(requestAccess({ "x-ndx-token": T }, T, store)).toBe("token");
    expect(requestAccess({ authorization: `Bearer ${session}` }, T, store)).toBe("session");
    expect(requestAccess({ "x-ndx-token": "nope" }, T, store)).toBe("public");
    expect(requestAccess({}, T, store)).toBe("public");
    // A server without a token is open.
    expect(requestAccess({}, null, null)).toBe("token");
  });
});

describe("answerAuthRoute", () => {
  it("mints a nonce for the per-user token only", () => {
    const store = new CredentialStore();
    const session = store.exchangeNonce(store.mintNonce().nonce)!.credential;
    expect(answerAuthRoute("nonce", "POST", {}, T, store, "token").status).toBe(200);
    expect(answerAuthRoute("nonce", "POST", { "x-ndx-token": session }, T, store, "session").status).toBe(401);
    expect(answerAuthRoute("nonce", "POST", {}, T, store, "public").status).toBe(401);
    expect(answerAuthRoute("nonce", "GET", {}, T, store, "token").status).toBe(405);
  });

  it("exchanges the nonce from the X-Ndx-Nonce header, once", () => {
    const store = new CredentialStore();
    const { nonce } = store.mintNonce();
    const first = answerAuthRoute("session", "POST", { "x-ndx-nonce": nonce }, T, store, "public");
    expect(first.status).toBe(200);
    expect(store.isSession(first.body.credential as string)).toBe(true);
    expect(answerAuthRoute("session", "POST", { "x-ndx-nonce": nonce }, T, store, "public").status).toBe(401);
  });

  it("issues tickets to any credential, and reports state without one", () => {
    const store = new CredentialStore();
    expect(answerAuthRoute("wsTicket", "POST", {}, T, store, "session").status).toBe(200);
    expect(answerAuthRoute("wsTicket", "POST", {}, T, store, "public").status).toBe(401);
    expect(answerAuthRoute("state", "GET", {}, T, store, "public").body).toEqual({ required: true, authenticated: false });
    expect(answerAuthRoute("state", "GET", {}, null, null, "token").body).toEqual({ required: false, authenticated: true });
  });
});

describe("authorizeUpgrade", () => {
  it("takes the token header or a ticket, spends the ticket, and strips it from the URL", () => {
    const store = new CredentialStore();
    const { ticket } = store.mintTicket();
    expect(authorizeUpgrade({ headers: {}, url: `/?ndx_ticket=${ticket}&x=1` }, T, store)).toEqual({ ok: true, url: "/?x=1" });
    expect(authorizeUpgrade({ headers: {}, url: `/?ndx_ticket=${ticket}` }, T, store).ok).toBe(false);
    expect(authorizeUpgrade({ headers: { "x-ndx-token": T }, url: "/" }, T, store).ok).toBe(true);
    expect(authorizeUpgrade({ headers: { cookie: `ndx_token=${T}` } as never, url: "/" }, T, store).ok).toBe(false);
    expect(authorizeUpgrade({ headers: {}, url: "/" }, null, null).ok).toBe(true);
  });
});

describe("URL helpers", () => {
  it("splitQueryParam removes one parameter and keeps the rest", () => {
    expect(splitQueryParam("/p/app/?ndx_ticket=a", "ndx_ticket")).toEqual({ value: "a", url: "/p/app/" });
    expect(splitQueryParam("/x?view=tree&ndx_ticket=a&y=1", "ndx_ticket")).toEqual({ value: "a", url: "/x?view=tree&y=1" });
    expect(splitQueryParam("/x?view=tree", "ndx_ticket")).toEqual({ value: null, url: "/x?view=tree" });
  });

  it("urlWithNonce appends the nonce, never a token", () => {
    expect(urlWithNonce("http://localhost:3117/", "N")).toBe("http://localhost:3117/?ndx_nonce=N");
    expect(urlWithNonce("http://localhost:3117/?x=1", "N")).toBe("http://localhost:3117/?x=1&ndx_nonce=N");
  });

  it("authRouteOf names only the credential routes", () => {
    expect(authRouteOf(AUTH_ROUTES.wsTicket)).toBe("wsTicket");
    expect(authRouteOf("/api/auth/other")).toBeNull();
  });
});
