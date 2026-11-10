/**
 * The scopes an OAuth connection's sign-in asks for, from its server
 * profile's `oauth` block (tracker/oauth-scopes.ts): the CAOS profile asks
 * for its read scopes only while every write tool is never and no tracker
 * sync rule through the connection is on, and adds its write scopes otherwise.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { HttpConnectionConfig } from "../../../../src/server/connections/connection-config.js";
import { connectionOAuthScopes } from "../../../../src/server/tracker/oauth-scopes.js";
import { loadServerProfile, parseServerProfile } from "../../../../src/server/tracker/server-profiles.js";
import { removeTempDir } from "../../../helpers/temp-dir.js";

const READ = ["caos:work-items:read", "caos:context:read"];
const WRITE = ["caos:work-items:create", "caos:work-items:edit", "caos:work-items:move"];
const NEVER = { policy: "never" };
const ALL_NEVER = { create_work_item: NEVER, edit_work_item: NEVER, move_work_item: NEVER };

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await removeTempDir(dir);
});

function setup(tools: unknown, trackerSync?: Record<string, unknown>): { projectDir: string; ndxHome: string; config: HttpConnectionConfig } {
  const projectDir = mkdtempSync(join(tmpdir(), "ndx-oauth-scopes-"));
  const ndxHome = mkdtempSync(join(tmpdir(), "ndx-oauth-scopes-home-"));
  dirs.push(projectDir, ndxHome);
  writeFileSync(join(projectDir, ".n-dx.local.json"), JSON.stringify(trackerSync ? { trackerSync: { project: "demo", ...trackerSync } } : {}));
  const config: HttpConnectionConfig = { id: "caos", label: "CAOS", transport: "http", url: "https://caos.example/mcp", auth: "oauth", profile: "caos", tools };
  return { projectDir, ndxHome, config };
}

const scopes = ({ projectDir, ndxHome, config }: ReturnType<typeof setup>) => connectionOAuthScopes(projectDir, config, { ndxHome });

describe("connection OAuth scopes", () => {
  it("the CAOS profile names its read and write scopes and the tools that write", () => {
    const caos = loadServerProfile("caos");
    expect("problems" in caos ? caos.problems : caos.oauth).toEqual({
      readScopes: READ,
      writeScopes: WRITE,
      writeTools: ["create_work_item", "edit_work_item", "move_work_item"],
    });
  });

  it("asks for the read scopes only when every write tool is never and no rule is on", () => {
    expect(scopes(setup(ALL_NEVER))).toEqual(READ);
    expect(scopes(setup(ALL_NEVER, { connection: "caos", rules: { "change-captured": "off" } }))).toEqual(READ);
    // A rule on through another connection is not this one's.
    expect(scopes(setup(ALL_NEVER, { connection: "other", rules: { "change-captured": "on" } }))).toEqual(READ);
  });

  it("adds the write scopes while a write tool may run, by default or by override", () => {
    expect(scopes(setup(undefined))).toEqual([...READ, ...WRITE]);
    expect(scopes(setup({ ...ALL_NEVER, move_work_item: { policy: "ask" } }))).toEqual([...READ, ...WRITE]);
    expect(scopes(setup({ ...ALL_NEVER, edit_work_item: { class: "read" } }))).toEqual([...READ, ...WRITE]);
  });

  it("adds the write scopes while a tracker sync rule through the connection is not off", () => {
    expect(scopes(setup(ALL_NEVER, { connection: "caos", rules: { "pr-opened": "on" } }))).toEqual([...READ, ...WRITE]);
    expect(scopes(setup(ALL_NEVER, { connection: "caos", rules: { "pr-opened": "dry-run" } }))).toEqual([...READ, ...WRITE]);
  });

  it("needs none without a profile, or with a profile that names no scopes", () => {
    const plain = setup(undefined);
    expect(connectionOAuthScopes(plain.projectDir, { ...plain.config, profile: undefined }, { ndxHome: plain.ndxHome })).toEqual([]);
    expect(connectionOAuthScopes(plain.projectDir, { ...plain.config, profile: "user:missing" }, { ndxHome: plain.ndxHome })).toEqual([]);
  });

  it("refuses an oauth block that is not lists of scopes, or write scopes with no write tools", () => {
    expect(parseServerProfile("x", { oauth: { readScopes: ["a b"] } })).toEqual({ problems: ["oauth.readScopes must be a list of scopes"] });
    expect(parseServerProfile("x", { oauth: { writeScopes: ["w"] } })).toEqual({ problems: ["oauth.writeScopes needs the writeTools that use them"] });
    expect(parseServerProfile("x", { oauth: "all" })).toEqual({ problems: ["oauth must be an object"] });
  });
});
