/**
 * `bin/serve.js` as the hub runs it: `PORT` in the environment, probed on
 * 127.0.0.1, every request forwarded with `/x/graview-face` stripped. The
 * page it serves must ask for everything under the mount, and each of those
 * requests, stripped or not, must answer. Run by hand with only an ambient
 * `PORT`, it serves at the root. Started for real, with Vite.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { underMount } from "../dev/hub-mount.js";

const BIN = resolve(import.meta.dirname, "../bin/serve.js");
const MOUNT = "/x/graview-face/";

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => done(port));
    });
  });
}

/**
 * Resolves when serve.js prints its URL, which it does only after Vite's
 * listen() resolved; rejects if it exits first. No deadline of its own: the
 * beforeAll hook timeout is the hang guardrail.
 */
function listening(child: ChildProcess, host: string): Promise<void> {
  let output = "";
  return new Promise((done, fail) => {
    const onData = (chunk: Buffer) => {
      // Vite bolds the port, so drop the colour codes before matching.
      output += String(chunk).replace(/\x1b\[[0-9;]*m/g, "");
      if (output.includes(host)) done();
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("exit", (code) => fail(new Error(`serve.js exited ${code} before listening:\n${output}`)));
  });
}

describe("the mount the hub serves the face at", () => {
  it("puts the stripped prefix back on a forwarded path, query and all", () => {
    expect(underMount(MOUNT, "/")).toBe(MOUNT);
    expect(underMount(MOUNT, "/src/main.tsx?v=1")).toBe(`${MOUNT}src/main.tsx?v=1`);
    expect(underMount(MOUNT, "/?token=abc")).toBe(`${MOUNT}?token=abc`);
  });

  it("leaves a path already under the mount alone", () => {
    expect(underMount(MOUNT, MOUNT)).toBe(MOUNT);
    expect(underMount(MOUNT, `${MOUNT}src/main.tsx?v=1`)).toBe(`${MOUNT}src/main.tsx?v=1`);
    expect(underMount(MOUNT, "/x/graview-face")).toBe("/x/graview-face");
    expect(underMount(MOUNT, "/x/graview-face?tab=2")).toBe("/x/graview-face?tab=2");
    // A sibling that merely shares the prefix is not under the mount.
    expect(underMount(MOUNT, "/x/graview-faces/a")).toBe(`${MOUNT}x/graview-faces/a`);
  });
});

/** Starts serve.js with `env` and resolves with its origin once it listens on `host`. */
async function startServe(env: NodeJS.ProcessEnv, host: string): Promise<{ child: ChildProcess; origin: string }> {
  const port = await freePort();
  const child = spawn(process.execPath, [BIN], { env: { ...env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
  await listening(child, `${host}:${port}`);
  return { child, origin: `http://${host}:${port}` };
}

describe("bin/serve.js by hand, with an ambient PORT", () => {
  let child: ChildProcess;
  let origin: string;

  beforeAll(async () => {
    const env = { ...process.env };
    delete env["NDX_EXTENSION_NAME"];
    ({ child, origin } = await startServe(env, "localhost"));
  }, 90_000);

  afterAll(() => {
    child?.kill();
  });

  it("serves the page at the root and its modules where it asks for them", async () => {
    const html = await (await fetch(`${origin}/`)).text();
    expect(html).toContain(`src="/src/main.tsx"`);
    expect(html).not.toContain(MOUNT);
    const main = await fetch(`${origin}/src/main.tsx`);
    expect(main.status).toBe(200);
    expect(await main.text()).toContain(`from "/src/app.ts"`);
    expect((await fetch(`${origin}/@vite/client`)).status).toBe(200);
  });
});

describe("bin/serve.js under the hub", () => {
  let child: ChildProcess;
  let origin: string;
  let scratch: string;

  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), "graview-face-serve-"));
    writeFileSync(join(scratch, "document.json"), JSON.stringify({ name: "hub-mounted" }));
    ({ child, origin } = await startServe({ ...process.env, NDX_EXTENSION_NAME: "graview-face", NDX_GRAVIEW_DIR: scratch }, "127.0.0.1"));
  }, 90_000);

  afterAll(() => {
    child?.kill();
    rmSync(scratch, { recursive: true, force: true });
  });

  it("listens on 127.0.0.1, where the hub probes, and answers the bare mount with the page", async () => {
    const response = await fetch(`${origin}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  it("writes every script the page loads under the mount", async () => {
    const html = await (await fetch(`${origin}/`)).text();
    expect(html).toContain(`src="${MOUNT}@vite/client"`);
    expect(html).toContain(`src="${MOUNT}src/main.tsx"`);
    expect(html).not.toMatch(/src="\/(?!x\/graview-face\/)/);
  });

  it("answers those scripts, stripped as the hub forwards them, and the modules they import ask under the mount too", async () => {
    const main = await fetch(`${origin}/src/main.tsx`);
    expect(main.status).toBe(200);
    const code = await main.text();
    expect(code).toContain(`from "${MOUNT}src/app.ts"`);
    expect(code).toContain(`from "${MOUNT}src/base.ts"`);
    expect((await fetch(`${origin}/@vite/client`)).status).toBe(200);
    const base = await (await fetch(`${origin}/src/base.ts`)).text();
    expect(base).toContain(JSON.stringify(MOUNT));
  });

  it("answers requests that already carry the mount, as the URL it prints sends them", async () => {
    const page = await fetch(`${origin}${MOUNT}`);
    expect(await page.text()).toContain(`src="${MOUNT}src/main.tsx"`);
    const main = await fetch(`${origin}${MOUNT}src/main.tsx`);
    expect(main.status).toBe(200);
    expect(main.headers.get("content-type")).not.toContain("text/html");
    const client = await fetch(`${origin}${MOUNT}@vite/client`);
    expect(client.status).toBe(200);
    expect(client.headers.get("content-type")).not.toContain("text/html");
  });

  it("serves the door's data and sync routes under the mount", async () => {
    const document = await fetch(`${origin}/data/document.json`);
    expect(document.status).toBe(200);
    expect(await document.json()).toEqual({ name: "hub-mounted" });
    const info = (await (await fetch(`${origin}/ndx/sync-info`)).json()) as { live: boolean };
    expect(info.live).toBe(true);
  });
});
