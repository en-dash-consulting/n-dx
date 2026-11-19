/**
 * `GET /api/rex/people`: git authors and product stewards, one entry per
 * email, and the current user as `ndx work --mine` resolves them.
 *
 * @see src/server/routes-rex/people.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { ServerContext } from "../../../src/server/types.js";
import { handleRexRoute } from "../../../src/server/routes-rex/index.js";
import { mergePeople, parseShortlog, stewardsOf, type PeopleAnswer } from "../../../src/server/routes-rex/people.js";
import { startRouteTestServer, type RouteTestServer } from "../../helpers/server-route-test-support.js";

// rex caches the actor for the process; the route's answer is pinned here.
vi.mock("../../../src/server/rex-gateway.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveActor: vi.fn(async () => "Ann Lee <ann@shop.io>"),
}));

const FIXTURE = resolve(__dirname, "../../../../rex/tests/fixtures/v2-tree");

describe("parseShortlog", () => {
  it("reads `git shortlog -sne` lines as identities, in order", () => {
    expect(parseShortlog("    12\tAnn Lee <ann@shop.io>\n     3\tBo <bo@shop.io>\r\n\n")).toEqual([
      "Ann Lee <ann@shop.io>",
      "Bo <bo@shop.io>",
    ]);
  });
});

describe("mergePeople", () => {
  it("keeps one entry per email, whatever its case or spelling", () => {
    const people = mergePeople([
      { id: "Ann Lee <ann@shop.io>", source: "git" },
      { id: "Ann L <ANN@shop.io>", source: "git" },
      { id: "ann@shop.io", source: "steward" },
    ]);
    expect(people).toEqual([
      { id: "Ann Lee <ann@shop.io>", name: "Ann Lee", email: "ann@shop.io", sources: ["git", "steward"] },
    ]);
  });

  it("gives a steward listed by email the git author's Name <email> id", () => {
    const people = mergePeople([
      { id: "bo@shop.io", source: "steward" },
      { id: "Bo Chen <bo@shop.io>", source: "git" },
    ]);
    expect(people).toEqual([{ id: "Bo Chen <bo@shop.io>", name: "Bo Chen", email: "bo@shop.io", sources: ["steward", "git"] }]);
  });

  it("keeps team handles and sorts by name", () => {
    const people = mergePeople([
      { id: "Zed <z@shop.io>", source: "git" },
      { id: "@shop/core", source: "steward" },
      { id: "Amy <a@shop.io>", source: "git" },
    ]);
    expect(people.map((p) => p.id)).toEqual(["@shop/core", "Amy <a@shop.io>", "Zed <z@shop.io>"]);
  });
});

describe("stewardsOf", () => {
  it("reads the root list and every area's", () => {
    const area = { type: "area", id: "a", title: "A", slug: "a", stewards: ["ann@shop.io"], children: [
      { type: "area", id: "b", title: "B", slug: "b", stewards: ["bo@shop.io"] },
    ] };
    expect(stewardsOf({ stewards: ["@shop/core"] }, [area] as never)).toEqual(["@shop/core", "ann@shop.io", "bo@shop.io"]);
  });
});

describe("GET /api/rex/people", () => {
  let dir: string;
  let started: RouteTestServer;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "rex-people-route-"));
    const rexDir = join(dir, ".rex");
    cpSync(FIXTURE, rexDir, { recursive: true });
    // The Checkout area names its own steward, who is also a git author.
    const areaIndex = join(rexDir, "product", "checkout", "index.md");
    writeFileSync(areaIndex, readFileSync(areaIndex, "utf-8").replace("summary:", 'stewards:\n  - "ann@shop.io"\nsummary:'));

    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
    git("init", "-q", "-b", "main");
    git("config", "commit.gpgsign", "false");
    for (const [name, email] of [["Ann Lee", "ann@shop.io"], ["Bo Chen", "bo@shop.io"]]) {
      writeFileSync(join(dir, `${name}.txt`), name);
      git("add", "-A");
      git("-c", `user.name=${name}`, "-c", `user.email=${email}`, "commit", "-q", "-m", `work by ${name}`);
    }

    const ctx: ServerContext = { projectDir: dir, svDir: join(dir, ".sourcevision"), rexDir, dev: false };
    started = await startRouteTestServer((req, res) => handleRexRoute(req, res, ctx));
  });

  afterEach(async () => {
    await started.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("lists git authors and stewards, deduplicated by email, with the current user", async () => {
    const res = await fetch(`${started.baseUrl}/api/rex/people`);
    expect(res.status).toBe(200);
    const body = await res.json() as PeopleAnswer;
    expect(body.me).toBe("Ann Lee <ann@shop.io>");
    expect(body.people).toEqual([
      { id: "@shop/core", name: "@shop/core", sources: ["steward"] },
      { id: "Ann Lee <ann@shop.io>", name: "Ann Lee", email: "ann@shop.io", sources: ["git", "steward"] },
      { id: "Bo Chen <bo@shop.io>", name: "Bo Chen", email: "bo@shop.io", sources: ["git"] },
    ]);
  });

  it("answers with the stewards alone outside a git repository", async () => {
    rmSync(join(dir, ".git"), { recursive: true, force: true });
    const body = await (await fetch(`${started.baseUrl}/api/rex/people`)).json() as PeopleAnswer;
    expect(body.people.map((p) => p.id)).toEqual(["@shop/core", "ann@shop.io"]);
  });
});
