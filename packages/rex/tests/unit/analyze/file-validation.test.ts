import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  validateFileInput,
  validateMarkdownContent,
  FileValidationError,
  SUPPORTED_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
} from "../../../src/analyze/file-validation.js";

// ── Temp directory management ──

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "rex-file-val-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ── Helper ──

async function writeTempFile(name: string, content: string | Buffer): Promise<string> {
  const path = join(tempDir, name);
  await writeFile(path, content);
  return path;
}

// ── SUPPORTED_EXTENSIONS ──

describe("SUPPORTED_EXTENSIONS", () => {
  it("includes markdown extensions", () => {
    expect(SUPPORTED_EXTENSIONS).toHaveProperty(".md");
    expect(SUPPORTED_EXTENSIONS).toHaveProperty(".markdown");
  });

  it("includes text extensions", () => {
    expect(SUPPORTED_EXTENSIONS).toHaveProperty(".txt");
  });

  it("includes structured data extensions", () => {
    expect(SUPPORTED_EXTENSIONS).toHaveProperty(".json");
    expect(SUPPORTED_EXTENSIONS).toHaveProperty(".yaml");
    expect(SUPPORTED_EXTENSIONS).toHaveProperty(".yml");
  });

  it("does not include binary formats", () => {
    expect(SUPPORTED_EXTENSIONS).not.toHaveProperty(".png");
    expect(SUPPORTED_EXTENSIONS).not.toHaveProperty(".exe");
    expect(SUPPORTED_EXTENSIONS).not.toHaveProperty(".zip");
  });
});

// ── FileValidationError ──

describe("FileValidationError", () => {
  it("extends Error with code and suggestion", () => {
    const err = new FileValidationError(
      "Unsupported format",
      "UNSUPPORTED_FORMAT",
      "Use .md, .txt, .json, or .yaml files",
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Unsupported format");
    expect(err.code).toBe("UNSUPPORTED_FORMAT");
    expect(err.suggestion).toBe("Use .md, .txt, .json, or .yaml files");
    expect(err.name).toBe("FileValidationError");
  });
});

// ── validateFileInput ──

describe("validateFileInput", () => {
  describe("file existence", () => {
    it("rejects non-existent files with clear error", async () => {
      const fakePath = join(tempDir, "does-not-exist.md");
      await expect(validateFileInput(fakePath)).rejects.toThrow(FileValidationError);
      try {
        await validateFileInput(fakePath);
      } catch (err) {
        expect((err as FileValidationError).code).toBe("FILE_NOT_FOUND");
        expect((err as FileValidationError).message).toContain("does-not-exist.md");
      }
    });
  });

  describe("file extension validation", () => {
    it("accepts .md files", async () => {
      const path = await writeTempFile("reqs.md", "# Requirements\n- Item 1");
      const result = await validateFileInput(path);
      expect(result.format).toBe("markdown");
      expect(result.filePath).toBe(path);
    });

    it("accepts .markdown files", async () => {
      const path = await writeTempFile("reqs.markdown", "# Requirements");
      const result = await validateFileInput(path);
      expect(result.format).toBe("markdown");
    });

    it("accepts .txt files", async () => {
      const path = await writeTempFile("reqs.txt", "Some requirements");
      const result = await validateFileInput(path);
      expect(result.format).toBe("text");
    });

    it("accepts .json files", async () => {
      const path = await writeTempFile("reqs.json", '{"title": "test"}');
      const result = await validateFileInput(path);
      expect(result.format).toBe("json");
    });

    it("accepts .yaml files", async () => {
      const path = await writeTempFile("reqs.yaml", "title: test");
      const result = await validateFileInput(path);
      expect(result.format).toBe("yaml");
    });

    it("accepts .yml files", async () => {
      const path = await writeTempFile("reqs.yml", "title: test");
      const result = await validateFileInput(path);
      expect(result.format).toBe("yaml");
    });

    it("rejects unsupported extensions with clear error", async () => {
      const path = await writeTempFile("image.png", "fake png content");
      await expect(validateFileInput(path)).rejects.toThrow(FileValidationError);
      try {
        await validateFileInput(path);
      } catch (err) {
        expect((err as FileValidationError).code).toBe("UNSUPPORTED_FORMAT");
        expect((err as FileValidationError).message).toContain(".png");
        expect((err as FileValidationError).suggestion).toContain(".md");
      }
    });

    it("rejects files with no extension", async () => {
      const path = await writeTempFile("Makefile", "all: build");
      await expect(validateFileInput(path)).rejects.toThrow(FileValidationError);
      try {
        await validateFileInput(path);
      } catch (err) {
        expect((err as FileValidationError).code).toBe("UNSUPPORTED_FORMAT");
      }
    });

    it("rejects binary-like extensions", async () => {
      for (const ext of [".exe", ".zip", ".tar", ".pdf", ".jpg"]) {
        const path = await writeTempFile(`file${ext}`, "content");
        await expect(validateFileInput(path)).rejects.toThrow(FileValidationError);
      }
    });
  });

  describe("file size validation", () => {
    it("rejects files exceeding maximum size", async () => {
      // Create a file just over the limit
      const oversize = Buffer.alloc(MAX_FILE_SIZE_BYTES + 1, "x");
      const path = await writeTempFile("huge.md", oversize);
      await expect(validateFileInput(path)).rejects.toThrow(FileValidationError);
      try {
        await validateFileInput(path);
      } catch (err) {
        expect((err as FileValidationError).code).toBe("FILE_TOO_LARGE");
        expect((err as FileValidationError).suggestion).toBeDefined();
      }
    });

    it("accepts files within size limit", async () => {
      const content = "# Requirements\n- Item 1\n".repeat(100);
      const path = await writeTempFile("normal.md", content);
      const result = await validateFileInput(path);
      expect(result.filePath).toBe(path);
    });
  });

  describe("binary content detection", () => {
    it("rejects files with null bytes (binary content)", async () => {
      const binaryContent = Buffer.from("PK\x03\x04\x00\x00binary data");
      const path = await writeTempFile("archive.txt", binaryContent);
      await expect(validateFileInput(path)).rejects.toThrow(FileValidationError);
      try {
        await validateFileInput(path);
      } catch (err) {
        expect((err as FileValidationError).code).toBe("BINARY_CONTENT");
      }
    });

    it("accepts valid UTF-8 text files", async () => {
      const content = "# Requirements\nUnicode: é, ñ, ü, 日本語";
      const path = await writeTempFile("unicode.md", content);
      const result = await validateFileInput(path);
      expect(result.format).toBe("markdown");
    });
  });

  describe("empty file handling", () => {
    it("rejects empty files", async () => {
      const path = await writeTempFile("empty.md", "");
      await expect(validateFileInput(path)).rejects.toThrow(FileValidationError);
      try {
        await validateFileInput(path);
      } catch (err) {
        expect((err as FileValidationError).code).toBe("EMPTY_FILE");
      }
    });

    it("rejects whitespace-only files", async () => {
      const path = await writeTempFile("blank.md", "   \n\n   \n");
      await expect(validateFileInput(path)).rejects.toThrow(FileValidationError);
      try {
        await validateFileInput(path);
      } catch (err) {
        expect((err as FileValidationError).code).toBe("EMPTY_FILE");
      }
    });
  });

  describe("return value", () => {
    it("returns filePath, format, and sizeBytes", async () => {
      const content = "# Requirements\n- Item 1";
      const path = await writeTempFile("reqs.md", content);
      const result = await validateFileInput(path);
      expect(result).toEqual({
        filePath: path,
        format: "markdown",
        sizeBytes: Buffer.byteLength(content),
      });
    });
  });
});

// ── validateMarkdownContent ──

describe("validateMarkdownContent", () => {
  it("returns no warnings for well-formed markdown", () => {
    const md = `# Heading 1
## Heading 2
Some paragraph text.

- Bullet item
- Another bullet

### Heading 3
More text.
`;
    const result = validateMarkdownContent(md);
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("detects unclosed code fences", () => {
    const md = `# Heading
\`\`\`javascript
const x = 1;
// missing closing fence
`;
    const result = validateMarkdownContent(md);
    expect(result.valid).toBe(true); // still processable, just warns
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("code fence");
  });

  it("detects deeply nested headings (h5+) that may not map well", () => {
    const md = `# H1
## H2
### H3
#### H4
##### H5
###### H6
`;
    const result = validateMarkdownContent(md);
    // Deep nesting is technically valid but may produce suboptimal mapping
    expect(result.warnings.some((w) => w.includes("deep") || w.includes("heading"))).toBe(true);
  });

  it("detects malformed heading syntax (missing space after #)", () => {
    const md = `#Missing space
##Also missing
`;
    const result = validateMarkdownContent(md);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes("heading") || w.includes("#"))).toBe(true);
  });

  it("returns valid for content with no markdown structure", () => {
    const result = validateMarkdownContent("Just plain text with no formatting.");
    expect(result.valid).toBe(true);
  });

  it("detects inconsistent heading hierarchy (skipping levels)", () => {
    const md = `# H1
### H3 (skips H2)
`;
    const result = validateMarkdownContent(md);
    expect(result.warnings.some((w) => w.includes("skip"))).toBe(true);
  });
});
