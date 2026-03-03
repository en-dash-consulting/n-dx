import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  validateFileInput,
  validateMarkdownContent,
  validateTextContent,
  validateJsonContent,
  validateYamlContent,
  detectMagicBytes,
  FileValidationError,
  SUPPORTED_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  LARGE_FILE_WARNING_BYTES,
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

  describe("content-type mismatch (magic bytes)", () => {
    it("rejects a .md file that contains PNG magic bytes", async () => {
      // PNG header: 0x89 0x50 0x4E 0x47
      const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      const content = Buffer.concat([pngHeader, Buffer.from("fake image data here")]);
      const path = await writeTempFile("sneaky.md", content);
      try {
        await validateFileInput(path);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(FileValidationError);
        // PNG header also has null byte, may get BINARY_CONTENT or CONTENT_TYPE_MISMATCH
        const code = (err as FileValidationError).code;
        expect(["BINARY_CONTENT", "CONTENT_TYPE_MISMATCH"]).toContain(code);
      }
    });

    it("rejects a .txt file that contains JPEG magic bytes", async () => {
      // JPEG starts with FF D8 FF — no null bytes, so it should hit magic bytes check
      const jpegHeader = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
      const fakeContent = Buffer.alloc(100, 0x41); // 'A' padding
      const content = Buffer.concat([jpegHeader, fakeContent]);
      const path = await writeTempFile("not-text.txt", content);
      try {
        await validateFileInput(path);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(FileValidationError);
        expect((err as FileValidationError).code).toBe("CONTENT_TYPE_MISMATCH");
        expect((err as FileValidationError).message).toContain("JPEG");
      }
    });

    it("rejects a .json file with PDF magic bytes", async () => {
      // PDF: %PDF (0x25 0x50 0x44 0x46) — no null bytes
      const pdfContent = Buffer.from("%PDF-1.4 fake pdf content here with enough text");
      const path = await writeTempFile("fake.json", pdfContent);
      try {
        await validateFileInput(path);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(FileValidationError);
        expect((err as FileValidationError).code).toBe("CONTENT_TYPE_MISMATCH");
        expect((err as FileValidationError).message).toContain("PDF");
      }
    });

    it("accepts a .md file with normal text content", async () => {
      const path = await writeTempFile("normal.md", "# Hello\nThis is markdown.");
      const result = await validateFileInput(path);
      expect(result.format).toBe("markdown");
    });
  });

  describe("large file warnings", () => {
    it("returns a warning for files over the warning threshold", async () => {
      // Create a file just over 5 MB
      const content = Buffer.alloc(LARGE_FILE_WARNING_BYTES + 1, "x");
      const path = await writeTempFile("large.md", content);
      const result = await validateFileInput(path);
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBeGreaterThan(0);
      expect(result.warnings![0]).toContain("MB");
    });

    it("returns no warnings for small files", async () => {
      const path = await writeTempFile("small.md", "# Small file\n- item");
      const result = await validateFileInput(path);
      expect(result.warnings).toBeUndefined();
    });
  });

  describe("return value", () => {
    it("returns filePath, format, and sizeBytes", async () => {
      const content = "# Requirements\n- Item 1";
      const path = await writeTempFile("reqs.md", content);
      const result = await validateFileInput(path);
      expect(result.filePath).toBe(path);
      expect(result.format).toBe("markdown");
      expect(result.sizeBytes).toBe(Buffer.byteLength(content));
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

  it("detects unclosed YAML front matter", () => {
    const md = `---
title: My Document
author: Test
# Missing closing ---

# Real Heading
Content here.
`;
    const result = validateMarkdownContent(md);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("front matter"))).toBe(true);
  });

  it("does not warn about properly closed front matter", () => {
    const md = `---
title: My Document
---

# Real Heading
Content here.
`;
    const result = validateMarkdownContent(md);
    expect(result.warnings.some((w) => w.includes("front matter"))).toBe(false);
  });

  it("detects unmatched HTML block-level tags", () => {
    const md = `# Requirements
<div>
Some nested content
<section>
  Inner section
</section>

## More content
`;
    const result = validateMarkdownContent(md);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("<div>"))).toBe(true);
  });

  it("does not warn about matched HTML tags", () => {
    const md = `# Requirements
<details>
<summary>Click to expand</summary>
Hidden content
</details>
`;
    const result = validateMarkdownContent(md);
    expect(result.warnings.some((w) => w.includes("Unmatched"))).toBe(false);
  });
});

// ── validateTextContent ──

describe("validateTextContent", () => {
  it("returns no warnings for well-structured text", () => {
    const text = `USER AUTHENTICATION
- Implement login flow
- Add OAuth2 support

API INFRASTRUCTURE
- Set up rate limiting
- Configure caching
`;
    const result = validateTextContent(text);
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("returns no warnings for text with requirement keywords", () => {
    const text = "The system must validate all user input. Users should be able to reset their passwords.";
    const result = validateTextContent(text);
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("warns about mixed indentation (tabs and spaces)", () => {
    const text = "\tTabbed line\n    Spaced line\nNormal line";
    const result = validateTextContent(text);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("Mixed indentation"))).toBe(true);
  });

  it("warns about very long lines", () => {
    const longLine = "x".repeat(600);
    const text = `${longLine}\n${longLine}\n${longLine}\n${longLine}\nNormal line`;
    const result = validateTextContent(text);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("500 characters"))).toBe(true);
  });

  it("warns when no structure or requirements detected", () => {
    const text = "This is a general observation about the project timeline and team dynamics.";
    const result = validateTextContent(text);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("No detectable structure"))).toBe(true);
  });

  it("accepts text with bullets (no headers needed)", () => {
    const text = "- First item\n- Second item\n- Third item";
    const result = validateTextContent(text);
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("accepts text with underlined headers", () => {
    const text = `Section
=======
Some content here
`;
    const result = validateTextContent(text);
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("accepts text with colon headers", () => {
    const text = `Backend: server components\n- API endpoints\n- Database`;
    const result = validateTextContent(text);
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});

// ── validateJsonContent ──

describe("validateJsonContent", () => {
  it("returns valid for well-formed JSON object", () => {
    const json = '{"title": "Requirements", "items": [{"name": "Auth"}]}';
    const result = validateJsonContent(json);
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("returns valid for JSON array", () => {
    const json = '[{"title": "Feature A"}, {"title": "Feature B"}]';
    const result = validateJsonContent(json);
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("returns invalid for malformed JSON with clear error", () => {
    const json = '{"title": "Requirements", items: [}';
    const result = validateJsonContent(json);
    expect(result.valid).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("JSON parse error");
  });

  it("warns about primitive top-level values", () => {
    const json = '"just a string"';
    const result = validateJsonContent(json);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("primitive"))).toBe(true);
  });

  it("warns about empty arrays", () => {
    const result = validateJsonContent("[]");
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("empty"))).toBe(true);
  });

  it("warns about empty objects", () => {
    const result = validateJsonContent("{}");
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("empty"))).toBe(true);
  });

  it("returns invalid for empty content", () => {
    const result = validateJsonContent("");
    expect(result.valid).toBe(false);
    expect(result.warnings.some((w) => w.includes("Empty"))).toBe(true);
  });

  it("returns invalid for whitespace-only content", () => {
    const result = validateJsonContent("   \n  ");
    expect(result.valid).toBe(false);
  });
});

// ── validateYamlContent ──

describe("validateYamlContent", () => {
  it("returns valid for well-formed YAML", () => {
    const yaml = `title: Requirements
description: Product requirements document
items:
  - name: Authentication
    priority: high
  - name: Dashboard
    priority: medium
`;
    const result = validateYamlContent(yaml);
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("warns about tab indentation", () => {
    const yaml = "items:\n\t- name: Auth\n\t- name: Dashboard";
    const result = validateYamlContent(yaml);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("Tab"))).toBe(true);
  });

  it("warns about inconsistent indentation", () => {
    const yaml = `title: test
items:
  - name: A
      description: nested too deep
   another: odd indent
`;
    const result = validateYamlContent(yaml);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("Inconsistent indentation"))).toBe(true);
  });

  it("warns about duplicate top-level keys", () => {
    const yaml = `title: First
description: First description
title: Second
`;
    const result = validateYamlContent(yaml);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("Duplicate"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("title"))).toBe(true);
  });

  it("handles YAML with front matter delimiter", () => {
    const yaml = `---
title: Document
items:
  - name: Feature
`;
    const result = validateYamlContent(yaml);
    expect(result.valid).toBe(true);
    // Should not flag anything about the front matter delimiter
    expect(result.warnings).toEqual([]);
  });

  it("does not warn about consistent 2-space indentation", () => {
    const yaml = `root:
  child:
    grandchild: value
  sibling: other
`;
    const result = validateYamlContent(yaml);
    expect(result.warnings.some((w) => w.includes("Inconsistent"))).toBe(false);
  });
});

// ── detectMagicBytes ──

describe("detectMagicBytes", () => {
  it("detects PNG files", () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    expect(detectMagicBytes(buffer)).toBe("PNG");
  });

  it("detects JPEG files", () => {
    const buffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
    expect(detectMagicBytes(buffer)).toBe("JPEG");
  });

  it("detects PDF files", () => {
    const buffer = Buffer.from("%PDF-1.4");
    expect(detectMagicBytes(buffer)).toBe("PDF");
  });

  it("detects ZIP files", () => {
    const buffer = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00]);
    expect(detectMagicBytes(buffer)).toBe("ZIP");
  });

  it("detects GIF files", () => {
    const buffer = Buffer.from("GIF89a");
    expect(detectMagicBytes(buffer)).toBe("GIF");
  });

  it("detects GZIP files", () => {
    const buffer = Buffer.from([0x1F, 0x8B, 0x08, 0x00]);
    expect(detectMagicBytes(buffer)).toBe("GZIP");
  });

  it("detects ELF binaries", () => {
    const buffer = Buffer.from([0x7F, 0x45, 0x4C, 0x46]);
    expect(detectMagicBytes(buffer)).toBe("ELF");
  });

  it("returns null for text content", () => {
    const buffer = Buffer.from("# Hello World\nThis is markdown.");
    expect(detectMagicBytes(buffer)).toBeNull();
  });

  it("returns null for JSON content", () => {
    const buffer = Buffer.from('{"title": "test"}');
    expect(detectMagicBytes(buffer)).toBeNull();
  });

  it("returns null for empty buffer", () => {
    const buffer = Buffer.alloc(0);
    expect(detectMagicBytes(buffer)).toBeNull();
  });

  it("returns null for buffer too small to match any signature", () => {
    const buffer = Buffer.from([0x89]); // Only one byte of PNG header
    expect(detectMagicBytes(buffer)).toBeNull();
  });
});

// ── New error codes ──

describe("new FileValidationError codes", () => {
  it("supports CONTENT_TYPE_MISMATCH code", () => {
    const err = new FileValidationError(
      "File content doesn't match extension",
      "CONTENT_TYPE_MISMATCH",
      "Rename or fix the file",
    );
    expect(err.code).toBe("CONTENT_TYPE_MISMATCH");
  });

  it("supports ENCODING_ERROR code", () => {
    const err = new FileValidationError(
      "Cannot read as UTF-8",
      "ENCODING_ERROR",
      "Re-save as UTF-8",
    );
    expect(err.code).toBe("ENCODING_ERROR");
  });

  it("supports PARSE_ERROR code", () => {
    const err = new FileValidationError(
      "Failed to parse content",
      "PARSE_ERROR",
      "Check syntax",
    );
    expect(err.code).toBe("PARSE_ERROR");
  });
});
