/**
 * Viewer sockets must go through `openWebSocket` (viewer/session.ts). On a
 * token-protected server a handshake needs a single-use ticket in its URL —
 * a browser cannot put the session header on it — and a bare
 * `new WebSocket(...)` is refused with 401.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const VIEWER_DIR = join(import.meta.dirname!, "..", "..", "..", "src", "viewer");

function collectTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? collectTsFiles(join(dir, e.name)) : /\.ts$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

describe("viewer sockets", () => {
  it("are opened only by openWebSocket", () => {
    const offenders = collectTsFiles(VIEWER_DIR)
      .filter((file) => !file.endsWith("session.ts"))
      .filter((file) => /new WebSocket\(/.test(readFileSync(file, "utf-8")))
      .map((file) => file.slice(VIEWER_DIR.length + 1));
    expect(offenders).toEqual([]);
  });
});
