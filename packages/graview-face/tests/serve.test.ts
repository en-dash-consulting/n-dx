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
  const child = spawn(process.execPath, [BIN], { env: { ...env, PORT: String(port) }, stdio: ["pipe", "pipe", "pipe"] });
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

const sidecarFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set("X-Ndx-Sidecar-Secret", "test-launch-secret");
  return fetch(input, { ...init, headers });
};

describe("bin/serve.js with an explicitly injected project projection", () => {
  let child: ChildProcess;
  let origin: string;
  let scratch: string;

  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), "graview-face-serve-"));
    writeFileSync(join(scratch, "document.json"), JSON.stringify({ name: "hub-mounted" }));
    const env: NodeJS.ProcessEnv = { ...process.env, NDX_EXTENSION_NAME: "graview-face", NDX_SIDECAR_SECRET: "test-launch-secret", NDX_GRAVIEW_DIR: scratch };
    delete env["NDX_REX_MCP_URL"];
    ({ child, origin } = await startServe(env, "127.0.0.1"));
  }, 90_000);

  afterAll(() => {
    child?.kill();
    rmSync(scratch, { recursive: true, force: true });
  });

  it("listens on 127.0.0.1, where the hub probes, and answers the bare mount with the page", async () => {
    const response = await sidecarFetch(`${origin}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  it("writes every script the page loads under the mount", async () => {
    const html = await (await sidecarFetch(`${origin}/`)).text();
    expect(html).toContain(`src="${MOUNT}@vite/client"`);
    expect(html).toContain(`src="${MOUNT}src/main.tsx"`);
    expect(html).not.toMatch(/src="\/(?!x\/graview-face\/)/);
  });

  it("answers those scripts, stripped as the hub forwards them, and the modules they import ask under the mount too", async () => {
    const main = await sidecarFetch(`${origin}/src/main.tsx`);
    expect(main.status).toBe(200);
    const code = await main.text();
    expect(code).toContain(`from "${MOUNT}src/app.ts"`);
    expect(code).toContain(`from "${MOUNT}src/base.ts"`);
    expect((await sidecarFetch(`${origin}/@vite/client`)).status).toBe(200);
    const base = await (await sidecarFetch(`${origin}/src/base.ts`)).text();
    expect(base).toContain(JSON.stringify(MOUNT));
  });

  it("answers requests that already carry the mount, as the URL it prints sends them", async () => {
    const page = await sidecarFetch(`${origin}${MOUNT}`);
    expect(await page.text()).toContain(`src="${MOUNT}src/main.tsx"`);
    const main = await sidecarFetch(`${origin}${MOUNT}src/main.tsx`);
    expect(main.status).toBe(200);
    expect(main.headers.get("content-type")).not.toContain("text/html");
    const client = await sidecarFetch(`${origin}${MOUNT}@vite/client`);
    expect(client.status).toBe(200);
    expect(client.headers.get("content-type")).not.toContain("text/html");
  });

  it("serves the door's data and sync routes under the mount", async () => {
    const document = await sidecarFetch(`${origin}/data/document.json`);
    expect(document.status).toBe(200);
    expect(await document.json()).toEqual({ name: "hub-mounted" });
    const info = (await (await sidecarFetch(`${origin}/ndx/sync-info`)).json()) as { live: boolean };
    expect(info.live).toBe(true);
  });

  it("hands POST /ndx/mcp to the MCP door, stripped or under the mount", async () => {
    const html = await (await sidecarFetch(`${origin}/`)).text();
    const key = /<meta name="ndx-door" content="([0-9a-f]+)"/.exec(html)?.[1];
    expect(key).toBeTruthy();
    for (const path of ["/ndx/mcp", `${MOUNT}ndx/mcp`]) {
      const response = await sidecarFetch(`${origin}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-ndx-door": key! },
        body: JSON.stringify({ name: "get_item", arguments: { id: "x" } }),
      });
      expect(response.status).toBe(200);
      // No rex endpoint is set, so the door reached the call and reports sync off.
      const body = (await response.json()) as { ok: boolean; error: string };
      expect(body).toMatchObject({ ok: false });
      expect(body.error).toContain("sync is off");
    }
  });
});


describe("the projectless environment supplied by the hub", () => {
  let child: ChildProcess;
  let origin: string;
  beforeAll(async () => {
    const env: NodeJS.ProcessEnv = { ...process.env, NDX_EXTENSION_NAME: "graview-face", NDX_SIDECAR_SECRET: "test-launch-secret" };
    delete env["NDX_GRAVIEW_DIR"];
    delete env["NDX_REX_MCP_URL"];
    ({ child, origin } = await startServe(env, "127.0.0.1"));
  });
  afterAll(() => child?.kill());
  it("rejects direct access and explains the project command through an authenticated request", async () => {
    expect((await fetch(origin)).status).toBe(403);
    const page = await sidecarFetch(origin);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("ndx graview serve &lt;project-directory&gt;");
    expect((await sidecarFetch(`${origin}/data/document.json`)).status).toBe(404);
  });
  it("exits when its hub lifetime pipe closes", async () => {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.stdin!.end();
    await exited;
    expect(child.exitCode).toBe(0);
  });
});
