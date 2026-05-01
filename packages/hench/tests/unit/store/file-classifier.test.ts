import { describe, it, expect } from "vitest";
import { classifyFile, classifyChangedFiles, getCodeFiles, hasCodeFiles } from "../../../src/store/file-classifier.js";
import type { ToolCallRecord } from "../../../src/schema/index.js";

describe("File Classifier", () => {
  describe("classifyFile", () => {
    describe("Code files", () => {
      it("classifies .ts files as code", () => {
        expect(classifyFile("src/index.ts")).toBe("code");
      });

      it("classifies .js files as code", () => {
        expect(classifyFile("lib/utils.js")).toBe("code");
      });

      it("classifies .tsx files as code", () => {
        expect(classifyFile("components/Button.tsx")).toBe("code");
      });

      it("classifies .jsx files as code", () => {
        expect(classifyFile("components/Card.jsx")).toBe("code");
      });

      it("classifies .py files as code", () => {
        expect(classifyFile("script.py")).toBe("code");
      });

      it("classifies .go files as code", () => {
        expect(classifyFile("main.go")).toBe("code");
      });

      it("classifies .rs files as code", () => {
        expect(classifyFile("src/lib.rs")).toBe("code");
      });

      it("classifies files without extension as code", () => {
        expect(classifyFile("Makefile")).toBe("code");
        expect(classifyFile("Dockerfile")).toBe("code");
      });
    });

    describe("Test files", () => {
      it("classifies .test.ts files as test", () => {
        expect(classifyFile("src/utils.test.ts")).toBe("test");
      });

      it("classifies .spec.js files as test", () => {
        expect(classifyFile("src/feature.spec.js")).toBe("test");
      });

      it("classifies .test.tsx files as test", () => {
        expect(classifyFile("components/Button.test.tsx")).toBe("test");
      });

      it("classifies files in __tests__/ directory as test", () => {
        expect(classifyFile("__tests__/unit/utils.ts")).toBe("test");
      });

      it("classifies files in /tests/ directory as test", () => {
        expect(classifyFile("tests/integration/api.test.ts")).toBe("test");
      });
    });

    describe("Documentation files", () => {
      it("classifies .md files as docs", () => {
        expect(classifyFile("README.md")).toBe("docs");
        expect(classifyFile("docs/guide.md")).toBe("docs");
      });

      it("classifies .mdx files as docs", () => {
        expect(classifyFile("docs/tutorial.mdx")).toBe("docs");
      });

      it("classifies .txt files as docs", () => {
        expect(classifyFile("CHANGELOG.txt")).toBe("docs");
      });

      it("classifies .rst files as docs", () => {
        expect(classifyFile("docs/index.rst")).toBe("docs");
      });
    });

    describe("Config files", () => {
      it("classifies .json files as config (except prd.json)", () => {
        expect(classifyFile("package.json")).toBe("config");
        expect(classifyFile("config.json")).toBe("config");
        expect(classifyFile("tsconfig.json")).toBe("config");
      });

      it("classifies .yaml files as config", () => {
        expect(classifyFile("config.yaml")).toBe("config");
        expect(classifyFile(".github/workflows/ci.yml")).toBe("config");
      });

      it("classifies .toml files as config", () => {
        expect(classifyFile("Cargo.toml")).toBe("config");
        expect(classifyFile("pyproject.toml")).toBe("config");
      });

      it("classifies .ini files as config", () => {
        expect(classifyFile("setup.ini")).toBe("config");
      });

      it("classifies .env files as config", () => {
        expect(classifyFile(".env")).toBe("config");
        expect(classifyFile(".env.example")).toBe("config");
      });

      it("classifies .config.js files as config", () => {
        expect(classifyFile("webpack.config.js")).toBe("config");
        expect(classifyFile("vitest.config.ts")).toBe("config");
      });
    });

    describe("Metadata files", () => {
      it("classifies prd.json as metadata", () => {
        expect(classifyFile("prd.json")).toBe("metadata");
      });

      it("classifies files in .rex/ directory as metadata", () => {
        expect(classifyFile(".rex/prd_tree/task-1/index.md")).toBe("metadata");
        expect(classifyFile(".rex/prd.md")).toBe("metadata");
      });
    });
  });

  describe("classifyChangedFiles", () => {
    it("extracts files from write_file tool calls", () => {
      const toolCalls: ToolCallRecord[] = [
        {
          turn: 1,
          tool: "write_file",
          input: { path: "src/index.ts", content: "code" },
          output: "Written",
          durationMs: 100,
        },
      ];

      const result = classifyChangedFiles(toolCalls);

      expect(result.size).toBe(1);
      expect(result.get("code")).toEqual(["src/index.ts"]);
    });

    it("detects metadata changes from rex_update tool calls", () => {
      const toolCalls: ToolCallRecord[] = [
        {
          turn: 1,
          tool: "rex_update",
          input: { status: "completed" },
          output: "Updated",
          durationMs: 50,
        },
      ];

      const result = classifyChangedFiles(toolCalls);

      expect(result.size).toBe(1);
      expect(result.get("metadata")).toEqual(["prd.json"]);
    });

    it("detects metadata changes from rex_add tool calls", () => {
      const toolCalls: ToolCallRecord[] = [
        {
          turn: 1,
          tool: "rex_add",
          input: { title: "New Task" },
          output: "Added",
          durationMs: 50,
        },
      ];

      const result = classifyChangedFiles(toolCalls);

      expect(result.get("metadata")).toEqual(["prd.json"]);
    });

    it("classifies multiple files into their categories", () => {
      const toolCalls: ToolCallRecord[] = [
        {
          turn: 1,
          tool: "write_file",
          input: { path: "src/feature.ts", content: "code" },
          output: "Written",
          durationMs: 100,
        },
        {
          turn: 1,
          tool: "write_file",
          input: { path: "README.md", content: "docs" },
          output: "Written",
          durationMs: 100,
        },
        {
          turn: 1,
          tool: "write_file",
          input: { path: "package.json", content: "config" },
          output: "Written",
          durationMs: 100,
        },
        {
          turn: 1,
          tool: "write_file",
          input: { path: "src/feature.test.ts", content: "test" },
          output: "Written",
          durationMs: 100,
        },
      ];

      const result = classifyChangedFiles(toolCalls);

      expect(result.get("code")).toEqual(["src/feature.ts"]);
      expect(result.get("docs")).toEqual(["README.md"]);
      expect(result.get("config")).toEqual(["package.json"]);
      expect(result.get("test")).toEqual(["src/feature.test.ts"]);
    });

    it("deduplicates file paths from write_file calls", () => {
      const toolCalls: ToolCallRecord[] = [
        {
          turn: 1,
          tool: "write_file",
          input: { path: "src/index.ts", content: "version 1" },
          output: "Written",
          durationMs: 100,
        },
        {
          turn: 2,
          tool: "write_file",
          input: { path: "src/index.ts", content: "version 2" },
          output: "Written",
          durationMs: 100,
        },
      ];

      const result = classifyChangedFiles(toolCalls);

      expect(result.get("code")).toEqual(["src/index.ts"]);
    });

    it("ignores non-write tool calls", () => {
      const toolCalls: ToolCallRecord[] = [
        {
          turn: 1,
          tool: "read_file",
          input: { path: "src/index.ts" },
          output: "Content",
          durationMs: 100,
        },
        {
          turn: 1,
          tool: "search_files",
          input: { pattern: "test" },
          output: "Results",
          durationMs: 50,
        },
        {
          turn: 1,
          tool: "git",
          input: { args: ["commit", "-m", "message"] },
          output: "Committed",
          durationMs: 100,
        },
      ];

      const result = classifyChangedFiles(toolCalls);

      expect(result.size).toBe(0);
    });

    it("returns empty map when no write tool calls present", () => {
      const toolCalls: ToolCallRecord[] = [
        {
          turn: 1,
          tool: "read_file",
          input: { path: "README.md" },
          output: "Content",
          durationMs: 100,
        },
      ];

      const result = classifyChangedFiles(toolCalls);

      expect(result.size).toBe(0);
    });
  });

  describe("getCodeFiles", () => {
    it("returns code files from classification map", () => {
      const classified = new Map([
        ["code", ["src/index.ts", "lib/utils.ts"]],
        ["docs", ["README.md"]],
        ["config", ["package.json"]],
      ]);

      const codeFiles = getCodeFiles(classified);

      expect(codeFiles).toEqual(["src/index.ts", "lib/utils.ts"]);
    });

    it("returns empty array when no code files present", () => {
      const classified = new Map([
        ["docs", ["README.md"]],
        ["config", ["package.json"]],
      ]);

      const codeFiles = getCodeFiles(classified);

      expect(codeFiles).toEqual([]);
    });

    it("returns empty array for empty classification map", () => {
      const classified = new Map();

      const codeFiles = getCodeFiles(classified);

      expect(codeFiles).toEqual([]);
    });
  });

  describe("hasCodeFiles", () => {
    it("returns true when code files are present", () => {
      const classified = new Map([
        ["code", ["src/index.ts"]],
      ]);

      const result = hasCodeFiles(classified);

      expect(result).toBe(true);
    });

    it("returns false when no code files present", () => {
      const classified = new Map([
        ["docs", ["README.md"]],
      ]);

      const result = hasCodeFiles(classified);

      expect(result).toBe(false);
    });

    it("returns false for empty classification map", () => {
      const classified = new Map();

      const result = hasCodeFiles(classified);

      expect(result).toBe(false);
    });

    it("returns false when code key exists but array is empty", () => {
      const classified = new Map([
        ["code", []],
      ]);

      const result = hasCodeFiles(classified);

      expect(result).toBe(false);
    });
  });
});
