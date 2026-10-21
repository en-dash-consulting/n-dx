import { describe, it, expect } from "vitest";
import { handleGetCapabilities } from "../../../src/cli/mcp-tools/get-capabilities.js";
import type { PRDStore, StoreCapabilities } from "../../../src/store/index.js";

function storeWith(caps: StoreCapabilities): PRDStore {
  return {
    loadConfig: async () => ({}),
    capabilities: () => caps,
  } as unknown as PRDStore;
}

async function report(caps: StoreCapabilities): Promise<Record<string, unknown>> {
  const result = await handleGetCapabilities(storeWith(caps));
  return JSON.parse(result.content[0].text);
}

describe("get_capabilities schemaVersion", () => {
  it("reports rex/v1 for a v1 tree", async () => {
    const out = await report({ adapter: "folder-tree", supportsTransactions: false, supportsWatch: false });
    expect(out.schemaVersion).toBe("rex/v1");
  });

  it("reports rex/v2 for a v2 tree", async () => {
    const out = await report({
      adapter: "v2-change-layer",
      supportsTransactions: true,
      supportsWatch: false,
      schemaVersion: "rex/v2",
    });
    expect(out.schemaVersion).toBe("rex/v2");
  });
});
