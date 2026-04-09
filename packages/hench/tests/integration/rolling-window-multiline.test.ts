/**
 * Integration smoke test: rolling window multi-line cap.
 *
 * Exercises the full output pipeline the way a hench run does during a
 * tool-use cycle that returns multi-line content (file reads, shell output,
 * test results). Asserts that the rolling window never exceeds 10 rendered
 * rows and that the capture buffer retains every physical line in full.
 *
 * @see packages/hench/src/types/output.ts — _pushWindowLine, _redrawWindow
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  stream,
  detail,
  resetRollingWindow,
  resetCapturedLines,
  getCapturedLines,
} from "../../src/cli/output.js";
import { _overrideTTY } from "../../src/types/output.js";

describe("rolling window multi-line cap — hench tool-cycle smoke test", () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    process.env.FORCE_COLOR = "1";
    const { resetColorCache } = await import("@n-dx/llm-client");
    resetColorCache();
    _overrideTTY(true);
    resetRollingWindow();
    resetCapturedLines();
  });

  afterEach(async () => {
    writeSpy.mockRestore();
    _overrideTTY(null);
    delete process.env.FORCE_COLOR;
    delete process.env.NO_COLOR;
    const { resetColorCache } = await import("@n-dx/llm-client");
    resetColorCache();
    resetRollingWindow();
    resetCapturedLines();
  });

  /** Count \x1b[2K writes emitted since the last writeSpy.mockClear(). */
  function countRenderedRows(): number {
    return writeSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((s) => s.startsWith("\x1b[2K")).length;
  }

  it("tool output with 20 lines never pushes rendered rows above 10", () => {
    // Simulate the agent output pattern during a tool-use cycle:
    //   stream("Agent", …)  — agent narrates its intent
    //   stream("Tool",  …)  — tool invocation is logged
    //   stream("Result", …) — multi-line tool output arrives
    //   detail(…)           — timing metadata
    stream("Agent", "running test suite");
    stream("Tool", "run_tests({suite: 'unit'})");

    // 20-line tool result (19 embedded newlines → 20 physical lines)
    const toolOutput = Array.from({ length: 20 }, (_, i) => `test line ${i + 1}`).join("\n");

    writeSpy.mockClear();
    stream("Result", toolOutput);
    expect(countRenderedRows()).toBeLessThanOrEqual(10);

    writeSpy.mockClear();
    detail("1 234ms elapsed, 0 failures");
    expect(countRenderedRows()).toBeLessThanOrEqual(10);
  });

  it("capture buffer retains all physical lines regardless of the display cap", () => {
    resetCapturedLines();

    stream("Agent", "reading source file");
    stream("Tool", "read_file({path: 'src/types/output.ts'})");

    // 15-line file content (14 embedded newlines → 15 physical lines)
    const fileContent = Array.from({ length: 15 }, (_, i) => `// line ${i + 1}`).join("\n");
    stream("Result", fileContent);

    detail("42ms");

    // 1 (Agent) + 1 (Tool) + 15 (Result physical lines) + 1 (detail) = 18
    expect(getCapturedLines().length).toBe(18);
  });
});
