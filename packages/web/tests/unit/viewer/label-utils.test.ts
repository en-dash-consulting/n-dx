import { describe, it, expect } from "vitest";
import { truncateFilename, basename } from "../../../src/viewer/utils.js";

describe("truncateFilename", () => {
  it("returns short names unchanged", () => {
    expect(truncateFilename("app.ts", 18)).toBe("app.ts");
    expect(truncateFilename("index.tsx", 18)).toBe("index.tsx");
  });

  it("truncates long names preserving extension", () => {
    const result = truncateFilename("very-long-component-name.tsx", 18);
    expect(result).toContain("…");
    expect(result).toMatch(/\.tsx$/);
    expect(result.length).toBeLessThanOrEqual(18);
  });

  it("preserves at least 4 chars of stem", () => {
    const result = truncateFilename("abcdefghijklmnop.tsx", 12);
    // stem budget = 12 - 4(.tsx) - 1(…) = 7, so we get 7 chars + … + .tsx = 12
    expect(result).toMatch(/^abcdefg…\.tsx$/);
    expect(result.length).toBe(12);
  });

  it("handles names without extension", () => {
    const result = truncateFilename("Dockerfile-very-long-name", 14);
    expect(result).toContain("…");
    expect(result.length).toBeLessThanOrEqual(14);
    expect(result).toMatch(/…$/);
  });

  it("handles names at exactly maxLen", () => {
    expect(truncateFilename("exactly18chars.ts", 17)).toBe("exactly18chars.ts");
  });

  it("uses default maxLen of 18", () => {
    const short = "short.ts";
    expect(truncateFilename(short)).toBe(short);

    const long = "this-is-a-very-long-filename.tsx";
    const result = truncateFilename(long);
    expect(result.length).toBeLessThanOrEqual(18);
    expect(result).toContain("…");
  });

  it("handles edge case of very long extensions", () => {
    // Extension .stories.tsx is long — stem budget < 4 triggers fallback
    const result = truncateFilename("ab.stories.tsx", 10);
    expect(result.length).toBeLessThanOrEqual(10);
    expect(result).toContain("…");
  });

  it("handles dot-only name", () => {
    // Edge: name is just ".gitignore"
    const result = truncateFilename(".gitignore-extended", 12);
    expect(result.length).toBeLessThanOrEqual(12);
  });

  it("returns empty string for empty input", () => {
    expect(truncateFilename("", 18)).toBe("");
  });

  it("preserves common extensions", () => {
    expect(truncateFilename("my-very-long-component.tsx", 20)).toMatch(/\.tsx$/);
    expect(truncateFilename("really-long-test-file.test.ts", 20)).toMatch(/\.ts$/);
    expect(truncateFilename("super-long-style-file.module.css", 20)).toMatch(/\.css$/);
  });
});

describe("truncateFilename edge cases for graph labels", () => {
  it("preserves directory-like separators in filenames", () => {
    // Some filenames might have dots that look like extensions
    const result = truncateFilename("my.component.test.tsx", 18);
    // Should preserve the final .tsx extension
    expect(result).toMatch(/\.tsx$/);
  });

  it("handles single-char names", () => {
    expect(truncateFilename("a", 18)).toBe("a");
    expect(truncateFilename("a.ts", 18)).toBe("a.ts");
  });

  it("handles exactly maxLen with extension", () => {
    // "exactly-max.ts" is 14 chars
    expect(truncateFilename("exactly-max.ts", 14)).toBe("exactly-max.ts");
  });
});

describe("basename", () => {
  it("extracts filename from path", () => {
    expect(basename("src/components/App.tsx")).toBe("App.tsx");
    expect(basename("packages/web/src/index.ts")).toBe("index.ts");
  });

  it("returns the name if no path separators", () => {
    expect(basename("App.tsx")).toBe("App.tsx");
  });

  it("returns the original path for empty segment", () => {
    expect(basename("")).toBe("");
  });
});
