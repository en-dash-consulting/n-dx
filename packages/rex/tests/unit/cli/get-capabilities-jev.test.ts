import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleGetCapabilities } from "../../../src/cli/mcp-tools/get-capabilities.js";
import type { PRDStore } from "../../../src/store/index.js";

// Placeholder only: a real-looking key would trip secret scanners.
const SECRET = "tsk-placeholder-capabilities-0123456789";

const store = {
  loadConfig: async () => ({}),
  capabilities: () => ({ adapter: "folder-tree", supportsTransactions: false, supportsWatch: false }),
} as unknown as PRDStore;

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "rex-caps-jev-"));
  vi.stubEnv("NDX_HOME", home);
  vi.stubEnv("TYPESAFE_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

async function report(): Promise<{ text: string; body: Record<string, unknown> }> {
  const text = (await handleGetCapabilities(store)).content[0].text;
  return { text, body: JSON.parse(text) };
}

describe("get_capabilities jev", () => {
  it("is unavailable with no key anywhere", async () => {
    expect((await report()).body.jev).toEqual({ available: false, source: null });
  });

  it("names env as the source of an exported key, never the key", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", SECRET);
    const { text, body } = await report();
    expect(body.jev).toEqual({ available: true, source: "env" });
    expect(text).not.toContain(SECRET);
  });
});
