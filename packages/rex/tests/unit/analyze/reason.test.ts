import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_MODEL,
  parseProposalResponse,
  detectFileFormat,
  parseStructuredFile,
  mergeProposals,
  reasonFromFiles,
  readProjectContext,
  chunkScanResults,
  summarizeScanResults,
  CHUNK_CHAR_LIMIT,
} from "../../../src/analyze/reason.js";
import type { Proposal } from "../../../src/analyze/propose.js";

describe("parseProposalResponse", () => {
  it("parses valid JSON array into proposals", () => {
    const json = JSON.stringify([
      {
        epic: { title: "Auth" },
        features: [
          {
            title: "Login",
            tasks: [
              { title: "Validate email", priority: "high" },
              { title: "Handle errors" },
            ],
          },
        ],
      },
    ]);

    const proposals = parseProposalResponse(json);

    expect(proposals).toHaveLength(1);
    expect(proposals[0].epic.title).toBe("Auth");
    expect(proposals[0].epic.source).toBe("llm");
    expect(proposals[0].features).toHaveLength(1);
    expect(proposals[0].features[0].title).toBe("Login");
    expect(proposals[0].features[0].source).toBe("llm");
    expect(proposals[0].features[0].tasks).toHaveLength(2);
    expect(proposals[0].features[0].tasks[0].title).toBe("Validate email");
    expect(proposals[0].features[0].tasks[0].priority).toBe("high");
    expect(proposals[0].features[0].tasks[0].source).toBe("llm");
    expect(proposals[0].features[0].tasks[0].sourceFile).toBe("");
  });

  it("strips markdown code fences", () => {
    const raw = '```json\n[{"epic":{"title":"UI"},"features":[{"title":"Dark mode","tasks":[]}]}]\n```';

    const proposals = parseProposalResponse(raw);

    expect(proposals).toHaveLength(1);
    expect(proposals[0].epic.title).toBe("UI");
  });

  it("strips code fences without json language tag", () => {
    const raw = '```\n[{"epic":{"title":"API"},"features":[]}]\n```';

    const proposals = parseProposalResponse(raw);

    expect(proposals).toHaveLength(1);
    expect(proposals[0].epic.title).toBe("API");
  });

  it("preserves optional fields", () => {
    const json = JSON.stringify([
      {
        epic: { title: "Core" },
        features: [
          {
            title: "Cache",
            description: "Add caching layer",
            tasks: [
              {
                title: "Redis integration",
                description: "Set up Redis client",
                acceptanceCriteria: ["Connection pooling", "Retry on failure"],
                priority: "critical",
                tags: ["infra", "perf"],
              },
            ],
          },
        ],
      },
    ]);

    const proposals = parseProposalResponse(json);
    const task = proposals[0].features[0].tasks[0];

    expect(proposals[0].features[0].description).toBe("Add caching layer");
    expect(task.description).toBe("Set up Redis client");
    expect(task.acceptanceCriteria).toEqual(["Connection pooling", "Retry on failure"]);
    expect(task.priority).toBe("critical");
    expect(task.tags).toEqual(["infra", "perf"]);
  });

  it("rejects invalid priority values", () => {
    const json = JSON.stringify([
      {
        epic: { title: "X" },
        features: [
          {
            title: "Y",
            tasks: [{ title: "Z", priority: "ultra" }],
          },
        ],
      },
    ]);

    expect(() => parseProposalResponse(json)).toThrow();
  });

  it("rejects missing epic title", () => {
    const json = JSON.stringify([
      {
        epic: {},
        features: [],
      },
    ]);

    expect(() => parseProposalResponse(json)).toThrow();
  });

  it("rejects missing task title", () => {
    const json = JSON.stringify([
      {
        epic: { title: "E" },
        features: [
          {
            title: "F",
            tasks: [{ description: "no title" }],
          },
        ],
      },
    ]);

    expect(() => parseProposalResponse(json)).toThrow();
  });

  it("rejects non-array input", () => {
    const json = JSON.stringify({
      epic: { title: "Single" },
      features: [],
    });

    expect(() => parseProposalResponse(json)).toThrow();
  });

  it("handles empty array", () => {
    const proposals = parseProposalResponse("[]");

    expect(proposals).toEqual([]);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseProposalResponse("not json")).toThrow();
  });

  it("handles multiple epics", () => {
    const json = JSON.stringify([
      { epic: { title: "A" }, features: [] },
      { epic: { title: "B" }, features: [{ title: "B1", tasks: [] }] },
    ]);

    const proposals = parseProposalResponse(json);

    expect(proposals).toHaveLength(2);
    expect(proposals[0].epic.title).toBe("A");
    expect(proposals[1].epic.title).toBe("B");
    expect(proposals[1].features).toHaveLength(1);
  });
});

describe("detectFileFormat", () => {
  it("detects markdown from .md extension", () => {
    expect(detectFileFormat("features.md")).toBe("markdown");
  });

  it("detects markdown from .txt extension", () => {
    expect(detectFileFormat("notes.txt")).toBe("markdown");
  });

  it("detects JSON from .json extension", () => {
    expect(detectFileFormat("requirements.json")).toBe("json");
  });

  it("detects YAML from .yaml extension", () => {
    expect(detectFileFormat("plan.yaml")).toBe("yaml");
  });

  it("detects YAML from .yml extension", () => {
    expect(detectFileFormat("plan.yml")).toBe("yaml");
  });

  it("defaults to markdown for unknown extensions", () => {
    expect(detectFileFormat("readme.rst")).toBe("markdown");
  });

  it("is case-insensitive", () => {
    expect(detectFileFormat("DATA.JSON")).toBe("json");
    expect(detectFileFormat("plan.YAML")).toBe("yaml");
    expect(detectFileFormat("doc.MD")).toBe("markdown");
  });

  it("handles full paths", () => {
    expect(detectFileFormat("/home/user/project/reqs.json")).toBe("json");
    expect(detectFileFormat("./docs/plan.yml")).toBe("yaml");
  });
});

describe("parseStructuredFile", () => {
  it("parses JSON file matching Proposal schema directly", () => {
    const content = JSON.stringify([
      {
        epic: { title: "Auth" },
        features: [
          {
            title: "Login",
            tasks: [
              { title: "Validate email", priority: "high" },
            ],
          },
        ],
      },
    ]);

    const proposals = parseStructuredFile(content, "json", []);

    expect(proposals).toHaveLength(1);
    expect(proposals[0].epic.title).toBe("Auth");
    expect(proposals[0].epic.source).toBe("file-import");
    expect(proposals[0].features[0].title).toBe("Login");
    expect(proposals[0].features[0].tasks[0].title).toBe("Validate email");
    expect(proposals[0].features[0].tasks[0].priority).toBe("high");
  });

  it("parses JSON file with flat items array", () => {
    const content = JSON.stringify([
      { title: "User Management", description: "CRUD for users" },
      { title: "Reporting", description: "Generate reports" },
    ]);

    const proposals = parseStructuredFile(content, "json", []);

    expect(proposals).toHaveLength(1);
    const featureTitles = proposals[0].features.map((f) => f.title);
    expect(featureTitles).toContain("User Management");
    expect(featureTitles).toContain("Reporting");
  });

  it("parses JSON file with nested objects", () => {
    const content = JSON.stringify({
      requirements: {
        features: [
          { name: "Dark Mode", description: "Theme support" },
          { name: "i18n", description: "Internationalization" },
        ],
      },
    });

    const proposals = parseStructuredFile(content, "json", []);

    expect(proposals).toHaveLength(1);
    const featureTitles = proposals[0].features.map((f) => f.title);
    expect(featureTitles).toContain("Dark Mode");
    expect(featureTitles).toContain("i18n");
  });

  it("parses YAML file with title/description pairs", () => {
    const content = `
title: Authentication
description: Handle user auth

title: API Gateway
description: Route requests
`;

    const proposals = parseStructuredFile(content, "yaml", []);

    expect(proposals).toHaveLength(1);
    const featureTitles = proposals[0].features.map((f) => f.title);
    expect(featureTitles).toContain("Authentication");
    expect(featureTitles).toContain("API Gateway");
  });

  it("parses YAML file with name fields", () => {
    const content = `
name: Cache Layer
description: In-memory caching

name: Rate Limiter
`;

    const proposals = parseStructuredFile(content, "yaml", []);

    expect(proposals).toHaveLength(1);
    const featureTitles = proposals[0].features.map((f) => f.title);
    expect(featureTitles).toContain("Cache Layer");
    expect(featureTitles).toContain("Rate Limiter");
  });

  it("returns null for markdown format", () => {
    const content = "# Features\n- Login\n- Signup";

    const result = parseStructuredFile(content, "markdown", []);

    expect(result).toBeNull();
  });

  it("returns null for empty JSON array", () => {
    const result = parseStructuredFile("[]", "json", []);

    expect(result).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    const result = parseStructuredFile("not json at all", "json", []);

    expect(result).toBeNull();
  });

  it("returns null for YAML with no recognizable items", () => {
    const content = `
server:
  port: 3000
  host: localhost
`;

    const result = parseStructuredFile(content, "yaml", []);

    expect(result).toBeNull();
  });

  it("deduplicates against existing PRD items", () => {
    const content = JSON.stringify([
      { title: "Existing Feature", description: "Already tracked" },
      { title: "New Feature", description: "Not yet tracked" },
    ]);

    const existing = [
      {
        id: "1",
        title: "Existing Feature",
        level: "feature" as const,
        status: "pending" as const,
      },
    ];

    const proposals = parseStructuredFile(content, "json", existing);

    expect(proposals).toHaveLength(1);
    const featureTitles = proposals[0].features.map((f) => f.title);
    expect(featureTitles).not.toContain("Existing Feature");
    expect(featureTitles).toContain("New Feature");
  });

  it("preserves description in JSON items", () => {
    const content = JSON.stringify([
      { title: "Feature X", description: "Does X things" },
    ]);

    const proposals = parseStructuredFile(content, "json", []);

    expect(proposals).not.toBeNull();
    const feature = proposals![0].features.find((f) => f.title === "Feature X");
    expect(feature?.description).toBe("Does X things");
  });

  it("preserves description in YAML items", () => {
    const content = `
title: Feature Y
description: Does Y things
`;

    const proposals = parseStructuredFile(content, "yaml", []);

    expect(proposals).not.toBeNull();
    const feature = proposals![0].features.find((f) => f.title === "Feature Y");
    expect(feature?.description).toBe("Does Y things");
  });
});

describe("mergeProposals", () => {
  it("merges proposals with the same epic title", () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "Auth", source: "file-import" },
        features: [
          { title: "Login", source: "file-import", tasks: [] },
        ],
      },
      {
        epic: { title: "Auth", source: "file-import" },
        features: [
          { title: "Signup", source: "file-import", tasks: [] },
        ],
      },
    ];

    const merged = mergeProposals(proposals);

    expect(merged).toHaveLength(1);
    expect(merged[0].epic.title).toBe("Auth");
    const titles = merged[0].features.map((f) => f.title);
    expect(titles).toContain("Login");
    expect(titles).toContain("Signup");
  });

  it("merges case-insensitively", () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "auth", source: "file-import" },
        features: [
          { title: "Login", source: "file-import", tasks: [] },
        ],
      },
      {
        epic: { title: "Auth", source: "file-import" },
        features: [
          { title: "Signup", source: "file-import", tasks: [] },
        ],
      },
    ];

    const merged = mergeProposals(proposals);

    expect(merged).toHaveLength(1);
    expect(merged[0].features).toHaveLength(2);
  });

  it("deduplicates features within the same epic", () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "Auth", source: "file-import" },
        features: [
          { title: "Login", source: "file-import", tasks: [] },
        ],
      },
      {
        epic: { title: "Auth", source: "file-import" },
        features: [
          { title: "Login", source: "file-import", tasks: [] },
        ],
      },
    ];

    const merged = mergeProposals(proposals);

    expect(merged).toHaveLength(1);
    expect(merged[0].features).toHaveLength(1);
  });

  it("merges tasks into existing features", () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "Auth", source: "file-import" },
        features: [
          {
            title: "Login",
            source: "file-import",
            tasks: [
              { title: "Validate email", source: "file-import", sourceFile: "" },
            ],
          },
        ],
      },
      {
        epic: { title: "Auth", source: "file-import" },
        features: [
          {
            title: "Login",
            source: "file-import",
            tasks: [
              { title: "Handle errors", source: "file-import", sourceFile: "" },
            ],
          },
        ],
      },
    ];

    const merged = mergeProposals(proposals);

    expect(merged).toHaveLength(1);
    expect(merged[0].features).toHaveLength(1);
    const taskTitles = merged[0].features[0].tasks.map((t) => t.title);
    expect(taskTitles).toContain("Validate email");
    expect(taskTitles).toContain("Handle errors");
  });

  it("deduplicates tasks within merged features", () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "Auth", source: "file-import" },
        features: [
          {
            title: "Login",
            source: "file-import",
            tasks: [
              { title: "Validate email", source: "file-import", sourceFile: "" },
            ],
          },
        ],
      },
      {
        epic: { title: "Auth", source: "file-import" },
        features: [
          {
            title: "Login",
            source: "file-import",
            tasks: [
              { title: "Validate email", source: "file-import", sourceFile: "" },
            ],
          },
        ],
      },
    ];

    const merged = mergeProposals(proposals);

    expect(merged[0].features[0].tasks).toHaveLength(1);
  });

  it("keeps distinct epics separate", () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "Auth", source: "file-import" },
        features: [{ title: "Login", source: "file-import", tasks: [] }],
      },
      {
        epic: { title: "Dashboard", source: "file-import" },
        features: [{ title: "Charts", source: "file-import", tasks: [] }],
      },
    ];

    const merged = mergeProposals(proposals);

    expect(merged).toHaveLength(2);
  });

  it("handles empty input", () => {
    expect(mergeProposals([])).toEqual([]);
  });

  it("does not mutate input proposals", () => {
    const original: Proposal[] = [
      {
        epic: { title: "Auth", source: "file-import" },
        features: [
          {
            title: "Login",
            source: "file-import",
            tasks: [
              { title: "Validate email", source: "file-import", sourceFile: "" },
            ],
          },
        ],
      },
      {
        epic: { title: "Auth", source: "file-import" },
        features: [
          {
            title: "Signup",
            source: "file-import",
            tasks: [],
          },
        ],
      },
    ];

    // Deep-copy to compare later
    const before = JSON.parse(JSON.stringify(original));
    mergeProposals(original);

    expect(original).toEqual(before);
  });
});

describe("reasonFromFiles", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-reason-files-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array for zero files", async () => {
    const result = await reasonFromFiles([], []);
    expect(result).toEqual([]);
  });

  it("processes a single JSON file", async () => {
    const content = JSON.stringify([
      {
        epic: { title: "Auth" },
        features: [
          { title: "Login", tasks: [{ title: "Validate email" }] },
        ],
      },
    ]);
    const filePath = join(tmpDir, "spec.json");
    await writeFile(filePath, content);

    const result = await reasonFromFiles([filePath], []);

    expect(result).toHaveLength(1);
    expect(result[0].epic.title).toBe("Auth");
  });

  it("combines multiple JSON files and merges same-epic proposals", async () => {
    const file1 = join(tmpDir, "auth.json");
    await writeFile(
      file1,
      JSON.stringify([
        {
          epic: { title: "Auth" },
          features: [
            { title: "Login", tasks: [{ title: "Validate email" }] },
          ],
        },
      ]),
    );

    const file2 = join(tmpDir, "auth2.json");
    await writeFile(
      file2,
      JSON.stringify([
        {
          epic: { title: "Auth" },
          features: [
            { title: "Signup", tasks: [{ title: "Create account" }] },
          ],
        },
      ]),
    );

    const result = await reasonFromFiles([file1, file2], []);

    expect(result).toHaveLength(1);
    expect(result[0].epic.title).toBe("Auth");
    const featureTitles = result[0].features.map((f) => f.title);
    expect(featureTitles).toContain("Login");
    expect(featureTitles).toContain("Signup");
  });

  it("combines files with distinct epics", async () => {
    const file1 = join(tmpDir, "auth.json");
    await writeFile(
      file1,
      JSON.stringify([
        {
          epic: { title: "Auth" },
          features: [{ title: "Login", tasks: [] }],
        },
      ]),
    );

    const file2 = join(tmpDir, "dashboard.json");
    await writeFile(
      file2,
      JSON.stringify([
        {
          epic: { title: "Dashboard" },
          features: [{ title: "Charts", tasks: [] }],
        },
      ]),
    );

    const result = await reasonFromFiles([file1, file2], []);

    expect(result).toHaveLength(2);
    const epicTitles = result.map((p) => p.epic.title);
    expect(epicTitles).toContain("Auth");
    expect(epicTitles).toContain("Dashboard");
  });

  it("combines JSON and YAML files", async () => {
    const jsonFile = join(tmpDir, "features.json");
    await writeFile(
      jsonFile,
      JSON.stringify([
        { title: "User Management", description: "CRUD for users" },
      ]),
    );

    const yamlFile = join(tmpDir, "more.yaml");
    await writeFile(
      yamlFile,
      `title: API Gateway\ndescription: Route requests\n`,
    );

    const result = await reasonFromFiles([jsonFile, yamlFile], []);

    expect(result.length).toBeGreaterThanOrEqual(1);
    const allFeatures = result.flatMap((p) => p.features.map((f) => f.title));
    expect(allFeatures).toContain("User Management");
    expect(allFeatures).toContain("API Gateway");
  });

  it("deduplicates against existing PRD items", async () => {
    const file1 = join(tmpDir, "spec.json");
    await writeFile(
      file1,
      JSON.stringify([
        { title: "Already Tracked", description: "Exists" },
        { title: "New Feature", description: "Fresh" },
      ]),
    );

    const existing = [
      {
        id: "1",
        title: "Already Tracked",
        level: "feature" as const,
        status: "pending" as const,
      },
    ];

    const result = await reasonFromFiles([file1], existing);

    const allFeatures = result.flatMap((p) => p.features.map((f) => f.title));
    expect(allFeatures).not.toContain("Already Tracked");
    expect(allFeatures).toContain("New Feature");
  });
});

describe("readProjectContext", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-context-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty string when no docs exist", async () => {
    const result = await readProjectContext(tmpDir);
    expect(result).toBe("");
  });

  it("reads CLAUDE.md when present", async () => {
    await writeFile(join(tmpDir, "CLAUDE.md"), "# My Project\nDoes cool stuff");

    const result = await readProjectContext(tmpDir);

    expect(result).toContain("CLAUDE.md");
    expect(result).toContain("# My Project");
    expect(result).toContain("Does cool stuff");
  });

  it("reads README.md when present", async () => {
    await writeFile(join(tmpDir, "README.md"), "# README\nProject description");

    const result = await readProjectContext(tmpDir);

    expect(result).toContain("README.md");
    expect(result).toContain("Project description");
  });

  it("reads both CLAUDE.md and README.md", async () => {
    await writeFile(join(tmpDir, "CLAUDE.md"), "Claude instructions");
    await writeFile(join(tmpDir, "README.md"), "Readme content");

    const result = await readProjectContext(tmpDir);

    expect(result).toContain("CLAUDE.md");
    expect(result).toContain("Claude instructions");
    expect(result).toContain("README.md");
    expect(result).toContain("Readme content");
  });

  it("skips empty files", async () => {
    await writeFile(join(tmpDir, "CLAUDE.md"), "");
    await writeFile(join(tmpDir, "README.md"), "Actual content");

    const result = await readProjectContext(tmpDir);

    expect(result).not.toContain("CLAUDE.md");
    expect(result).toContain("README.md");
    expect(result).toContain("Actual content");
  });

  it("truncates content exceeding max length", async () => {
    const longContent = "x".repeat(5000);
    await writeFile(join(tmpDir, "CLAUDE.md"), longContent);

    const result = await readProjectContext(tmpDir);

    expect(result).toContain("...(truncated)");
    // Should be under the max limit plus header overhead
    expect(result.length).toBeLessThan(4200);
  });

  it("stops reading files once budget is exhausted", async () => {
    const longContent = "y".repeat(4000);
    await writeFile(join(tmpDir, "CLAUDE.md"), longContent);
    await writeFile(join(tmpDir, "README.md"), "Should not appear");

    const result = await readProjectContext(tmpDir);

    expect(result).toContain("CLAUDE.md");
    expect(result).not.toContain("README.md");
  });

  it("reads plain README file", async () => {
    await writeFile(join(tmpDir, "README"), "Plain readme");

    const result = await readProjectContext(tmpDir);

    expect(result).toContain("README");
    expect(result).toContain("Plain readme");
  });
});

describe("DEFAULT_MODEL", () => {
  it("is exported and is a non-empty string", () => {
    expect(typeof DEFAULT_MODEL).toBe("string");
    expect(DEFAULT_MODEL.length).toBeGreaterThan(0);
  });

  it("contains a claude model identifier", () => {
    expect(DEFAULT_MODEL).toMatch(/^claude-/);
  });
});

describe("summarizeScanResults", () => {
  it("formats a single result with all fields", () => {
    const results: import("../../../src/analyze/scanners.js").ScanResult[] = [
      {
        name: "Login flow",
        source: "test",
        sourceFile: "tests/auth.test.ts",
        kind: "task",
        description: "Handles login",
        acceptanceCriteria: ["Email valid", "Token issued"],
        priority: "high",
        tags: ["auth"],
      },
    ];

    const summary = summarizeScanResults(results);

    expect(summary).toContain("[task] Login flow");
    expect(summary).toContain("source: test");
    expect(summary).toContain("description: Handles login");
    expect(summary).toContain("criteria: Email valid; Token issued");
    expect(summary).toContain("priority: high");
    expect(summary).toContain("tags: auth");
  });

  it("handles results with no optional fields", () => {
    const results: import("../../../src/analyze/scanners.js").ScanResult[] = [
      {
        name: "Basic feature",
        source: "doc",
        sourceFile: "docs/readme.md",
        kind: "feature",
      },
    ];

    const summary = summarizeScanResults(results);

    expect(summary).toContain("[feature] Basic feature");
    expect(summary).not.toContain("description:");
    expect(summary).not.toContain("criteria:");
    expect(summary).not.toContain("priority:");
    expect(summary).not.toContain("tags:");
  });

  it("returns empty string for empty array", () => {
    expect(summarizeScanResults([])).toBe("");
  });
});

describe("chunkScanResults", () => {
  function makeScanResult(name: string): import("../../../src/analyze/scanners.js").ScanResult {
    return {
      name,
      source: "test",
      sourceFile: `tests/${name}.test.ts`,
      kind: "task",
      description: `Description for ${name}`,
      priority: "medium",
    };
  }

  it("returns a single chunk when results fit within limit", () => {
    const results = [makeScanResult("small-task")];
    const chunks = chunkScanResults(results);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual(results);
  });

  it("returns empty array for empty input", () => {
    expect(chunkScanResults([])).toEqual([]);
  });

  it("splits results into multiple chunks when they exceed the limit", () => {
    // Create enough results to exceed the character limit
    // Each result summarizes to ~80-100 chars, so at 40K limit we need ~500+ results
    const longDesc = "x".repeat(200);
    const results = Array.from({ length: 300 }, (_, i) => ({
      name: `Task number ${i} with a reasonably long title`,
      source: "test" as const,
      sourceFile: `tests/feature-area-${i}/component-${i}.test.ts`,
      kind: "task" as const,
      description: longDesc,
      acceptanceCriteria: ["Criterion A", "Criterion B"],
      priority: "medium" as const,
      tags: ["tag-a", "tag-b"],
    }));

    const chunks = chunkScanResults(results);

    expect(chunks.length).toBeGreaterThan(1);

    // All original results should be present across all chunks
    const totalResults = chunks.reduce((sum, c) => sum + c.length, 0);
    expect(totalResults).toBe(results.length);

    // Each chunk's summary should be within the character limit
    for (const chunk of chunks) {
      const summary = summarizeScanResults(chunk);
      expect(summary.length).toBeLessThanOrEqual(CHUNK_CHAR_LIMIT);
    }
  });

  it("preserves result order within chunks", () => {
    const results = Array.from({ length: 5 }, (_, i) => makeScanResult(`task-${i}`));
    const chunks = chunkScanResults(results);

    const flattened = chunks.flat();
    for (let i = 0; i < results.length; i++) {
      expect(flattened[i].name).toBe(results[i].name);
    }
  });

  it("puts a single oversized result in its own chunk", () => {
    const hugeResult: import("../../../src/analyze/scanners.js").ScanResult = {
      name: "Huge task",
      source: "test",
      sourceFile: "tests/huge.test.ts",
      kind: "task",
      description: "x".repeat(CHUNK_CHAR_LIMIT + 1000),
    };
    const smallResult = makeScanResult("small");

    const chunks = chunkScanResults([hugeResult, smallResult]);

    expect(chunks.length).toBe(2);
    expect(chunks[0]).toEqual([hugeResult]);
    expect(chunks[1]).toEqual([smallResult]);
  });
});
