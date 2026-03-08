/**
 * Domain gateway contract test — verify the web→sourcevision import seam
 * re-exports the expected symbols.
 *
 * domain-gateway.ts is the sole runtime import point from sourcevision
 * into the web package. A silent rename or removal in sourcevision's
 * public API would break MCP route handling at runtime. This test
 * catches such breakage at CI time.
 *
 * @see packages/web/src/server/domain-gateway.ts
 * @see packages/web/tests/unit/server/type-consistency.test.ts — rex gateway equivalent
 */

import { describe, it, expect } from "vitest";
import { createSourcevisionMcpServer } from "../../../src/server/domain-gateway.js";

describe("domain-gateway contract", () => {
  it("re-exports createSourcevisionMcpServer as a function", () => {
    expect(typeof createSourcevisionMcpServer).toBe("function");
  });

  it("re-exports match canonical sourcevision exports", async () => {
    const canonical = await import("../../../../sourcevision/src/public.js");
    expect(createSourcevisionMcpServer).toBe(
      canonical.createSourcevisionMcpServer,
    );
  });
});
