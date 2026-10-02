import { describe, expect, it } from "vitest";
import {
  authCookie,
  isAuthenticated,
  parseCookieValue,
  presentedToken,
  splitTokenQuery,
  tokensEqual,
  urlWithToken,
} from "../../../src/shared/auth.js";

const T = "abc123-XYZ_token";

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
  it("reads the bearer header, then X-Ndx-Token, then the cookie", () => {
    expect(presentedToken({ authorization: `Bearer ${T}` })).toBe(T);
    expect(presentedToken({ authorization: `bearer   ${T}  ` })).toBe(T);
    expect(presentedToken({ "x-ndx-token": ` ${T} ` })).toBe(T);
    expect(presentedToken({ cookie: `theme=dark; ndx_token=${T}; other=1` })).toBe(T);
    expect(presentedToken({ cookie: `ndx_token=${encodeURIComponent("a b")}` })).toBe("a b");
  });

  it("ignores a non-bearer Authorization, a duplicated header, and an unrelated cookie", () => {
    expect(presentedToken({ authorization: "Basic abc" })).toBeNull();
    expect(presentedToken({ "x-ndx-token": [T, T] })).toBeNull();
    expect(presentedToken({ cookie: "ndx_tokenx=1; x=ndx_token=2" })).toBeNull();
    expect(presentedToken({})).toBeNull();
  });

  it("isAuthenticated combines the two", () => {
    expect(isAuthenticated({ cookie: `ndx_token=${T}` }, T)).toBe(true);
    expect(isAuthenticated({ cookie: `ndx_token=${T}x` }, T)).toBe(false);
  });
});

describe("parseCookieValue", () => {
  it("handles spacing, missing and malformed entries", () => {
    expect(parseCookieValue("a=1;  b=2 ;c", "b")).toBe("2");
    expect(parseCookieValue("a=1", "b")).toBeNull();
    expect(parseCookieValue(undefined, "b")).toBeNull();
    expect(parseCookieValue("b=%E0%A4%A", "b")).toBe("%E0%A4%A"); // bad escape: raw value, no throw
  });
});

describe("splitTokenQuery", () => {
  it("removes only the token parameter and keeps the rest of the URL", () => {
    expect(splitTokenQuery(`/p/app/?ndx_token=${T}`)).toEqual({ token: T, location: "/p/app/" });
    expect(splitTokenQuery(`/prd?view=tree&ndx_token=${T}&x=1`)).toEqual({ token: T, location: "/prd?view=tree&x=1" });
    expect(splitTokenQuery("/prd?view=tree")).toEqual({ token: null, location: "/prd?view=tree" });
    expect(splitTokenQuery("/")).toEqual({ token: null, location: "/" });
  });
});

describe("authCookie and urlWithToken", () => {
  it("sets an HttpOnly, SameSite=Strict, path-wide cookie without Secure", () => {
    const c = authCookie(T);
    expect(c).toContain(`ndx_token=${T}`);
    expect(c).toContain("Path=/");
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Strict");
    expect(c).not.toContain("Secure");
  });

  it("appends the token with the right separator", () => {
    expect(urlWithToken("http://localhost:3117/", T)).toBe(`http://localhost:3117/?ndx_token=${T}`);
    expect(urlWithToken("http://localhost:3117/?x=1", T)).toBe(`http://localhost:3117/?x=1&ndx_token=${T}`);
  });
});
