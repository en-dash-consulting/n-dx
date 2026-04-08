import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setQuiet, isQuiet, info, result, section, subsection, stream, detail } from "../../../src/cli/output.js";

// ANSI escape codes asserted in the label-color tests below
const DIM    = "\x1b[2m";
const YELLOW = "\x1b[33m";
const CYAN   = "\x1b[36m";
const ANSI_PREFIX = "\x1b[";

describe("CLI output", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    setQuiet(false);
  });

  afterEach(() => {
    logSpy.mockRestore();
    setQuiet(false);
  });

  describe("setQuiet / isQuiet", () => {
    it("defaults to non-quiet", () => {
      expect(isQuiet()).toBe(false);
    });

    it("can enable quiet mode", () => {
      setQuiet(true);
      expect(isQuiet()).toBe(true);
    });
  });

  describe("info()", () => {
    it("prints when not quiet", () => {
      info("hello");
      expect(logSpy).toHaveBeenCalledWith("hello");
    });

    it("suppresses output when quiet", () => {
      setQuiet(true);
      info("hello");
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe("result()", () => {
    it("always prints", () => {
      setQuiet(true);
      result("essential");
      expect(logSpy).toHaveBeenCalledWith("essential");
    });
  });

  describe("section()", () => {
    it("prints a section header with rules", () => {
      section("My Section");
      expect(logSpy).toHaveBeenCalledTimes(1);
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain("═");
      expect(output).toContain("❯ My Section");
    });

    it("suppresses output when quiet", () => {
      setQuiet(true);
      section("My Section");
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe("subsection()", () => {
    it("prints a subsection header with dashes", () => {
      subsection("Turn 1/10");
      expect(logSpy).toHaveBeenCalledTimes(1);
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain("── Turn 1/10 ");
      expect(output).toContain("─");
    });

    it("suppresses output when quiet", () => {
      setQuiet(true);
      subsection("Turn 1/10");
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe("stream()", () => {
    it("prints a labelled line with padded tag", () => {
      stream("Agent", "Hello world");
      expect(logSpy).toHaveBeenCalledTimes(1);
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain("[Agent]");
      expect(output).toContain("Hello world");
    });

    it("pads short labels for alignment", () => {
      stream("Tool", "read_file(…)");
      const output = logSpy.mock.calls[0][0] as string;
      // [Tool] is 6 chars, padded to 10, so there's whitespace before the text
      expect(output).toMatch(/\[Tool\]\s+read_file/);
    });

    it("suppresses output when quiet", () => {
      setQuiet(true);
      stream("Agent", "Hello world");
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe("detail()", () => {
    it("prints indented detail text", () => {
      detail("42ms");
      expect(logSpy).toHaveBeenCalledTimes(1);
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain("42ms");
      // Should be indented to align with stream content
      expect(output).toMatch(/^\s+42ms$/);
    });

    it("suppresses output when quiet", () => {
      setQuiet(true);
      detail("42ms");
      expect(logSpy).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// stream() label color mapping
// Verifies that [Tool], [Agent], and vendor labels are color-coded correctly,
// and that NO_COLOR / non-TTY environments produce plain text.
// ---------------------------------------------------------------------------

/**
 * Reset the llm-client color cache so env-var changes take effect.
 * Imported directly from @n-dx/llm-client (tests are exempt from the
 * gateway-import rule — gateways are a production-code concern).
 */
async function resetColor(): Promise<void> {
  const { resetColorCache } = await import("@n-dx/llm-client");
  resetColorCache();
}

function setColorMode(mode: "force" | "none" | "clear"): void {
  if (mode === "force") {
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;
  } else if (mode === "none") {
    process.env.NO_COLOR = "1";
    delete process.env.FORCE_COLOR;
  } else {
    delete process.env.FORCE_COLOR;
    delete process.env.NO_COLOR;
  }
}

describe("stream() label color mapping", () => {
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    spy.mockRestore();
    setColorMode("clear");
    await resetColor();
  });

  // ── [Tool] → colorDim (grey/dim) ─────────────────────────────────────────

  it("[Tool] label contains dim ANSI code when color is forced", async () => {
    setColorMode("force");
    await resetColor();
    stream("Tool", "read_file(...)");
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain(DIM);
    expect(output).toContain("[Tool]");
  });

  it("[Tool] label is plain text (no ANSI) when NO_COLOR=1", async () => {
    setColorMode("none");
    await resetColor();
    stream("Tool", "read_file(...)");
    const output = spy.mock.calls[0][0] as string;
    expect(output).not.toContain(ANSI_PREFIX);
    expect(output).toContain("[Tool]");
  });

  // ── [Agent] → colorWarn (yellow) ─────────────────────────────────────────

  it("[Agent] label contains yellow ANSI code when color is forced", async () => {
    setColorMode("force");
    await resetColor();
    stream("Agent", "Some agent response");
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain(YELLOW);
    expect(output).toContain("[Agent]");
  });

  it("[Agent] label is plain text (no ANSI) when NO_COLOR=1", async () => {
    setColorMode("none");
    await resetColor();
    stream("Agent", "Some agent response");
    const output = spy.mock.calls[0][0] as string;
    expect(output).not.toContain(ANSI_PREFIX);
    expect(output).toContain("[Agent]");
  });

  // ── vendor labels → colorInfo (cyan/blue) ────────────────────────────────

  it("[Codex] vendor label contains cyan ANSI code when color is forced", async () => {
    setColorMode("force");
    await resetColor();
    stream("Codex", "vendor output line");
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain(CYAN);
    expect(output).toContain("[Codex]");
  });

  it("[claude] vendor label contains cyan ANSI code when color is forced", async () => {
    setColorMode("force");
    await resetColor();
    stream("claude", "vendor output line");
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain(CYAN);
    expect(output).toContain("[claude]");
  });

  it("[Codex] vendor label is plain text (no ANSI) when NO_COLOR=1", async () => {
    setColorMode("none");
    await resetColor();
    stream("Codex", "vendor output line");
    const output = spy.mock.calls[0][0] as string;
    expect(output).not.toContain(ANSI_PREFIX);
    expect(output).toContain("[Codex]");
  });

  // ── unlisted labels → no color ───────────────────────────────────────────

  it("unlisted labels (e.g. [Result]) render without ANSI codes even when color is forced", async () => {
    setColorMode("force");
    await resetColor();
    stream("Result", "some output");
    const output = spy.mock.calls[0][0] as string;
    // [Result] has no entry in STREAM_LABEL_COLORS — expect plain bracket
    expect(output).not.toContain(ANSI_PREFIX);
    expect(output).toContain("[Result]");
  });

  // ── alignment is preserved with and without color ─────────────────────────

  it("visible padding is the same whether or not color is applied", async () => {
    // Color-off baseline
    setColorMode("none");
    await resetColor();
    stream("Tool", "x");
    const plainOutput = (spy.mock.calls[0][0] as string);
    spy.mockClear();

    // Color-on
    setColorMode("force");
    await resetColor();
    stream("Tool", "x");
    const coloredOutput = (spy.mock.calls[0][0] as string);

    // Strip all ANSI codes from the colored version and compare visible text
    const stripped = coloredOutput.replace(/\x1b\[[0-9;]*m/g, "");
    expect(stripped).toBe(plainOutput);
  });
});
