import { vi } from "vitest";

/** The scripted app-server has a fictitious administrator-owned system file.
 * Only that exact file is synthetic. Native fixtures inspect the actual host. */
export const fixtureSystemLayer = {
  name: { type: "system", file: "/scripted-codex-system/config.toml" }, version: "fixture", config: {},
};

vi.mock("../../src/agent/lifecycle/codex-system-config.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../../src/agent/lifecycle/codex-system-config.js")>();
  return { isProtectedCodexConfig: (file: string) =>
    file === fixtureSystemLayer.name.file || actual.isProtectedCodexConfig(file) };
});
