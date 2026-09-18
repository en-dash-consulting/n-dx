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
import { readFile } from "node:fs/promises";
import { startPreviewServer, resolvePreviewDoc, layoutPathFor, type PreviewServerHandle } from "../../src/server/preview.js";

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

  it("leaves a self-polling document's reload handling alone", async () => {
    const dir = await scratch();

    // A plain document gets the injected poller.
    const plain = join(dir, "plain.html");
    await writeFile(plain, "<html><body>plain</body></html>", "utf-8");
    handle = await startPreviewServer(dir, 0, { file: plain });
    const plainHtml = await (await fetch(`http://127.0.0.1:${handle.port}/`)).text();
    expect(plainHtml).toContain("/__preview/state");
    expect(plainHtml).toContain("location.reload()");
    await handle.close();

    // One that already watches the endpoint does not: it decides for itself
    // when a change needs a reload and when it can refresh in place. A second
    // injected poller would reload it on every layout save.
    const own = join(dir, "own.html");
    await writeFile(
      own,
      '<html><body>own<script>fetch("/__preview/state")</' + 'script></body></html>',
      "utf-8",
    );
    handle = await startPreviewServer(dir, 0, { file: own });
    const ownHtml = await (await fetch(`http://127.0.0.1:${handle.port}/`)).text();
    expect(ownHtml).not.toContain("location.reload()");
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

/**
 * The layout endpoint is the only thing this server writes. The page is the
 * editor and the JSON file is the artifact reviewers diff, so a save that does
 * not land on disk loses the work silently — the page has nowhere else to keep
 * it.
 */
describe("preview layout endpoint", () => {
  async function serveDoc(): Promise<{ base: string; doc: string }> {
    const dir = await scratch();
    const doc = join(dir, "mock.html");
    await writeFile(doc, "<html><body>doc</body></html>", "utf-8");
    handle = await startPreviewServer(dir, 0, { file: doc });
    return { base: `http://127.0.0.1:${handle.port}`, doc };
  }

  it("round-trips a layout through disk", async () => {
    const { base, doc } = await serveDoc();

    // Nothing saved yet — the page falls back to what it ships with.
    expect((await fetch(base + "/__preview/layout")).status).toBe(404);

    const layout = { nav: [{ id: "grp-1", kind: "folder", label: "GROUP", children: [] }] };
    const saved = await fetch(base + "/__preview/layout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(layout),
    });
    expect(saved.status).toBe(200);
    const body = await saved.json();
    expect(body.ok).toBe(true);
    expect(body.path).toBe(layoutPathFor(doc));

    // On disk, and served back on the next load.
    expect(JSON.parse(await readFile(layoutPathFor(doc), "utf-8"))).toEqual(layout);
    expect(await (await fetch(base + "/__preview/layout")).json()).toEqual(layout);
  });

  it("reports the post-save fingerprint so the page does not reload over its own write", async () => {
    const { base } = await serveDoc();

    const before = await (await fetch(base + "/__preview/state")).json();
    const res = await fetch(base + "/__preview/layout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nav: [] }),
    });
    const body = await res.json();

    expect(body.fingerprint).not.toBe(before.fingerprint);
    // The page adopts this value as its baseline, so it must be the same one
    // the poller will read next.
    expect(body.fingerprint).toBe((await (await fetch(base + "/__preview/state")).json()).fingerprint);
  });

  it("refuses a body that is not JSON rather than corrupting the layout", async () => {
    const { base, doc } = await serveDoc();

    const good = JSON.stringify({ nav: [{ id: "keep", kind: "folder", label: "KEEP", children: [] }] });
    await fetch(base + "/__preview/layout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: good,
    });

    const bad = await fetch(base + "/__preview/layout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not json",
    });
    expect(bad.status).toBe(400);

    // The previous good layout survived — a rejected write is not a write.
    expect(JSON.parse(await readFile(layoutPathFor(doc), "utf-8"))).toEqual(JSON.parse(good));
  });
});
