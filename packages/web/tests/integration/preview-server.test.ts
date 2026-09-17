/**
 * The preview server's two load-bearing properties.
 *
 * `ndx start --preview` exists to run *next to* a real dashboard while someone
 * reshuffles the UI. Two things make that safe, and neither is visible from the
 * module's shape alone:
 *
 *  1. **It re-reads the document on every request.** The whole workflow is
 *     "edit the HTML, save, watch the browser". A cached read would still pass
 *     a naive "serves HTML" test while making the tool useless, so the test
 *     edits the file between two requests and asserts the second one changed.
 *
 *  2. **It serves nothing outside the document's directory.** The preview reads
 *     arbitrary files by request path so a mock-up can pull in a stylesheet or
 *     a screenshot next to it; the directory check is what stops that from
 *     being a read-anything hole on a port bound for local development.
 *
 * The reload fingerprint is asserted alongside (1) because the browser polls it
 * to decide when to reload — a static fingerprint means a never-reloading page.
 *
 * @see packages/web/src/server/preview.ts
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startPreviewServer, resolvePreviewDoc, type PreviewServerHandle } from "../../src/server/preview.js";

let handle: PreviewServerHandle | null = null;
const tempDirs: string[] = [];

afterEach(async () => {
  await handle?.close();
  handle = null;
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ndx-preview-"));
  tempDirs.push(dir);
  return dir;
}

describe("preview server", () => {
  it("serves the document fresh on every request", async () => {
    const dir = await scratch();
    const doc = join(dir, "mock.html");
    await writeFile(doc, "<html><body>first</body></html>", "utf-8");

    handle = await startPreviewServer(dir, 0, { file: doc });
    const base = `http://127.0.0.1:${handle.port}`;

    const first = await (await fetch(base + "/")).text();
    expect(first).toContain("first");
    // Live reload needs a client-side poller in the served page, not just a
    // fresh read on the server side.
    expect(first).toContain("/__preview/state");

    const beforeEdit = await (await fetch(base + "/__preview/state")).json();

    // mtime resolution: make sure the edit lands on a distinguishable stamp.
    await new Promise((r) => setTimeout(r, 20));
    await writeFile(doc, "<html><body>second — edited</body></html>", "utf-8");

    const second = await (await fetch(base + "/")).text();
    expect(second).toContain("second — edited");
    expect(second).not.toContain("first");

    const afterEdit = await (await fetch(base + "/__preview/state")).json();
    expect(afterEdit.fingerprint).not.toBe(beforeEdit.fingerprint);
  });

  it("refuses to serve files outside the document's directory", async () => {
    const dir = await scratch();
    const doc = join(dir, "mock.html");
    await writeFile(doc, "<html><body>doc</body></html>", "utf-8");
    await writeFile(join(dir, "sibling.css"), "body{}", "utf-8");

    handle = await startPreviewServer(dir, 0, { file: doc });
    const base = `http://127.0.0.1:${handle.port}`;

    // A sibling of the document is fair game — mock-ups reference local assets.
    expect((await fetch(base + "/sibling.css")).status).toBe(200);

    // Anything above it is not.
    for (const path of ["/../../../../etc/passwd", "/%2e%2e/%2e%2e/etc/passwd"]) {
      expect((await fetch(base + path)).status).toBe(404);
    }
  });

  it("fails loudly when the requested document does not exist", async () => {
    const dir = await scratch();
    await expect(startPreviewServer(dir, 0, { file: join(dir, "absent.html") })).rejects.toThrow(
      /Preview document not found/,
    );
  });

  it("ships a default document so --preview works with no arguments", () => {
    expect(resolvePreviewDoc()).toMatch(/preview[/\\]index\.html$/);
  });
});
