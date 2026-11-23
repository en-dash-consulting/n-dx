import { describe, expect, it } from "vitest";

import { withoutUrlUserinfo } from "../../src/url-userinfo.js";
import { BOUNDED_TEST_TIMEOUT_MS, callWithinBudget } from "../helpers/call-within-budget.js";

const URL_USERINFO = new URL("../../src/url-userinfo.ts", import.meta.url);

describe("withoutUrlUserinfo", () => {
  it.each([
    ["https://u:pw@api.example.invalid/v1", "https://api.example.invalid/v1"],
    ["https://tok@git.example.invalid/org/repo.git", "https://git.example.invalid/org/repo.git"],
    ["mysql://app:pa/ss@db/app", "mysql://db/app"],
    ["tcp://:se/cret@redis:6379", "tcp://redis:6379"],
    ["postgres://u:p#ss@h/db", "postgres://h/db"],
    ["pgsql://app:p@ss@pg/app", "pgsql://pg/app"],
    ["redis://:a/b?c#d@cache:6379/0", "redis://cache:6379/0"],
    ["mysql://u:a/b@[::1]:3306/db", "mysql://[::1]:3306/db"],
    ["redis://:/abc@cache:6379", "redis://cache:6379"],
    ["mysql://u:/abc@db/app", "mysql://db/app"],
    ["mysql://u:123456/x@db/app", "mysql://db/app"],
  ])("drops the userinfo of %s", (input, expected) => {
    expect(withoutUrlUserinfo(input)).toBe(expected);
    expect(withoutUrlUserinfo(expected)).toBe(expected);
  });

  it.each([
    "https://example.com/a@b",
    "https://registry.example.org/@scope/pkg",
    "https://host:8080/x@y",
    "https://[::1]:8080/x@y",
    "https://[::1]/x@y",
    "git@example.com:org/repo.git",
    "mailto:a@b.example",
    "https://u:p/w@not a host",
  ])("keeps %s", (text) => {
    expect(withoutUrlUserinfo(text)).toBe(text);
  });

  it("reads each URL of a text on its own", () => {
    expect(withoutUrlUserinfo("https://a:b@h/x?next=https://c:d/e@h2/")).toBe("https://h/x?next=https://h2/");
  });

  it(
    "runs in linear time on long userinfo and host runs",
    async () => {
      const texts = [`https://u:${"/".repeat(100_000)}@${"a".repeat(100_000)}!`, `https://u:p/@${"a.".repeat(100_000)}!`];
      for (const text of texts) {
        expect(await callWithinBudget<typeof withoutUrlUserinfo>(URL_USERINFO, "withoutUrlUserinfo", text)).toBe(text);
      }
    },
    BOUNDED_TEST_TIMEOUT_MS,
  );
});
