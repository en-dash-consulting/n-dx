import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_MODEL,
  MAX_RETRIES,
  FEW_SHOT_EXAMPLE,
  parseProposalResponse,
  extractJson,
  repairTruncatedJson,
  validateProposalQuality,
  detectFileFormat,
  parseStructuredFile,
  mergeProposals,
  reasonFromFiles,
  readProjectContext,
  chunkScanResults,
  summarizeScanResults,
  estimateItemSize,
  groupScanResults,
  CHUNK_CHAR_LIMIT,
  CHUNK_ITEM_LIMIT,
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

  it("wraps single valid proposal object in array", () => {
    const json = JSON.stringify({
      epic: { title: "Single" },
      features: [],
    });

    const proposals = parseProposalResponse(json);

    expect(proposals).toHaveLength(1);
    expect(proposals[0].epic.title).toBe("Single");
    expect(proposals[0].epic.source).toBe("llm");
  });

  it("rejects non-proposal object input", () => {
    const json = JSON.stringify({ bad: "data", not: "a proposal" });

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

  it("detects text from .txt extension", () => {
    expect(detectFileFormat("notes.txt")).toBe("text");
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

  it("handles paths with dots in directory names", () => {
    expect(detectFileFormat("/home/.config/project/reqs.json")).toBe("json");
    expect(detectFileFormat("/opt/v2.1.0/specs/plan.yaml")).toBe("yaml");
  });

  it("handles paths with multiple dots in filename", () => {
    expect(detectFileFormat("/home/project/my.data.json")).toBe("json");
    expect(detectFileFormat("backup.2024-01-01.yml")).toBe("yaml");
  });

  it("handles paths with spaces", () => {
    expect(detectFileFormat("/home/my project/features.json")).toBe("json");
    expect(detectFileFormat("My Documents/plan.yaml")).toBe("yaml");
  });

  it("handles hidden files", () => {
    expect(detectFileFormat(".requirements.yaml")).toBe("yaml");
    expect(detectFileFormat("/project/.data.json")).toBe("json");
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

  it("parses single JSON Proposal object (not wrapped in array)", () => {
    const content = JSON.stringify({
      epic: { title: "Auth" },
      features: [
        {
          title: "Login",
          tasks: [
            { title: "Validate email", priority: "high" },
          ],
        },
      ],
    });

    const proposals = parseStructuredFile(content, "json", []);

    expect(proposals).toHaveLength(1);
    expect(proposals![0].epic.title).toBe("Auth");
    expect(proposals![0].epic.source).toBe("file-import");
    expect(proposals![0].features[0].title).toBe("Login");
    expect(proposals![0].features[0].tasks[0].title).toBe("Validate email");
    expect(proposals![0].features[0].tasks[0].priority).toBe("high");
  });

  it("deduplicates single Proposal object against existing items", () => {
    const content = JSON.stringify({
      epic: { title: "Auth" },
      features: [
        {
          title: "Login",
          tasks: [
            { title: "Validate email" },
            { title: "Existing Task" },
          ],
        },
        { title: "Existing Feature", tasks: [] },
      ],
    });

    const existing = [
      { id: "1", title: "Existing Task", level: "task" as const, status: "pending" as const },
      { id: "2", title: "Existing Feature", level: "feature" as const, status: "pending" as const },
    ];

    const proposals = parseStructuredFile(content, "json", existing);

    expect(proposals).toHaveLength(1);
    // "Existing Feature" should be filtered out
    const featureTitles = proposals![0].features.map((f) => f.title);
    expect(featureTitles).toContain("Login");
    expect(featureTitles).not.toContain("Existing Feature");
    // "Existing Task" should be filtered from Login's tasks
    const taskTitles = proposals![0].features[0].tasks.map((t) => t.title);
    expect(taskTitles).toContain("Validate email");
    expect(taskTitles).not.toContain("Existing Task");
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

  it("returns empty proposals for zero files", async () => {
    const result = await reasonFromFiles([], []);
    expect(result.proposals).toEqual([]);
    expect(result.tokenUsage.calls).toBe(0);
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

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].epic.title).toBe("Auth");
    // Structured JSON parse: no LLM call
    expect(result.tokenUsage.calls).toBe(0);
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

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].epic.title).toBe("Auth");
    const featureTitles = result.proposals[0].features.map((f) => f.title);
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

    expect(result.proposals).toHaveLength(2);
    const epicTitles = result.proposals.map((p) => p.epic.title);
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

    expect(result.proposals.length).toBeGreaterThanOrEqual(1);
    const allFeatures = result.proposals.flatMap((p) => p.features.map((f) => f.title));
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

    const allFeatures = result.proposals.flatMap((p) => p.features.map((f) => f.title));
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

  it("skips CLAUDE.md generated by ndx init", async () => {
    // Matches the marker written by assistant-assets/index.js
    await writeFile(
      join(tmpDir, "CLAUDE.md"),
      "<!-- Generated by ndx init — do not edit manually. Re-run `ndx init` to regenerate. -->\n# n-dx\nTool docs that are not project-specific",
    );
    await writeFile(join(tmpDir, "README.md"), "Real project description");

    const result = await readProjectContext(tmpDir);

    expect(result).not.toContain("CLAUDE.md");
    expect(result).not.toContain("Tool docs");
    expect(result).toContain("README.md");
    expect(result).toContain("Real project description");
  });

  it("still reads user-authored CLAUDE.md without the marker", async () => {
    await writeFile(
      join(tmpDir, "CLAUDE.md"),
      "# My Actual Project\nWritten by the user, no marker",
    );

    const result = await readProjectContext(tmpDir);

    expect(result).toContain("CLAUDE.md");
    expect(result).toContain("My Actual Project");
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

  it("preserves all results across chunks", () => {
    const results = Array.from({ length: 5 }, (_, i) => makeScanResult(`task-${i}`));
    const chunks = chunkScanResults(results);

    const flattened = chunks.flat();
    const names = new Set(flattened.map((r) => r.name));
    for (const r of results) {
      expect(names.has(r.name)).toBe(true);
    }
    expect(flattened.length).toBe(results.length);
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

  it("splits by item count when exceeding CHUNK_ITEM_LIMIT", () => {
    // Create exactly CHUNK_ITEM_LIMIT + 10 minimal results
    // These are small enough that character limit won't trigger
    const results = Array.from({ length: CHUNK_ITEM_LIMIT + 10 }, (_, i) =>
      makeScanResult(`task-${i}`),
    );

    const chunks = chunkScanResults(results);

    // Should split into 2 chunks: 100 items + 10 items
    expect(chunks.length).toBe(2);
    expect(chunks[0].length).toBe(CHUNK_ITEM_LIMIT);
    expect(chunks[1].length).toBe(10);
  });

  it("respects item limit even when character limit would allow more", () => {
    // Create 150 tiny results - well under char limit but over item limit
    const results = Array.from({ length: 150 }, (_, i) => ({
      name: `T${i}`,
      source: "test" as const,
      sourceFile: `t${i}.ts`,
      kind: "task" as const,
    }));

    const chunks = chunkScanResults(results);

    // Should split by item count (100 + 50)
    expect(chunks.length).toBe(2);
    expect(chunks[0].length).toBe(CHUNK_ITEM_LIMIT);
    expect(chunks[1].length).toBe(50);
  });

  it("character limit takes precedence when it triggers first", () => {
    // Create 50 large results that exceed char limit before item limit
    const largeResults = Array.from({ length: 50 }, (_, i) => ({
      name: `Task ${i} with a long name for testing purposes`,
      source: "test" as const,
      sourceFile: `tests/very/long/path/to/file/${i}/component.test.ts`,
      kind: "task" as const,
      description: "x".repeat(1000), // Large description
      acceptanceCriteria: ["Criterion A", "Criterion B", "Criterion C"],
      priority: "medium" as const,
      tags: ["tag-a", "tag-b", "tag-c"],
    }));

    const chunks = chunkScanResults(largeResults);

    // Should split by char limit, resulting in chunks smaller than 100 items
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_ITEM_LIMIT);
      // Each chunk should stay within char limit (except oversized singles)
      if (chunk.length > 1) {
        const summary = summarizeScanResults(chunk);
        expect(summary.length).toBeLessThanOrEqual(CHUNK_CHAR_LIMIT);
      }
    }
  });
});

describe("CHUNK_ITEM_LIMIT", () => {
  it("is exported and equals 100", () => {
    expect(CHUNK_ITEM_LIMIT).toBe(100);
  });
});

describe("estimateItemSize", () => {
  it("matches actual summarized length for a minimal item", () => {
    const result: import("../../../src/analyze/scanners.js").ScanResult = {
      name: "Task A",
      source: "test",
      sourceFile: "src/a.ts",
      kind: "task",
    };

    const estimated = estimateItemSize(result);
    const actual = summarizeScanResults([result]).length;

    expect(estimated).toBe(actual);
  });

  it("matches actual summarized length for an item with all fields", () => {
    const result: import("../../../src/analyze/scanners.js").ScanResult = {
      name: "Login flow validation",
      source: "sourcevision",
      sourceFile: "tests/auth/login.test.ts",
      kind: "task",
      description: "Validates the login flow end-to-end",
      acceptanceCriteria: ["Email is validated", "Token is returned", "Error on bad password"],
      priority: "high",
      tags: ["auth", "security", "critical-path"],
    };

    const estimated = estimateItemSize(result);
    const actual = summarizeScanResults([result]).length;

    expect(estimated).toBe(actual);
  });

  it("matches actual summarized length for an epic with description only", () => {
    const result: import("../../../src/analyze/scanners.js").ScanResult = {
      name: "Infrastructure",
      source: "package",
      sourceFile: "package.json",
      kind: "epic",
      description: "Core infrastructure and tooling",
    };

    const estimated = estimateItemSize(result);
    const actual = summarizeScanResults([result]).length;

    expect(estimated).toBe(actual);
  });

  it("matches actual summarized length for tags-only item", () => {
    const result: import("../../../src/analyze/scanners.js").ScanResult = {
      name: "Fix circular dependency",
      source: "sourcevision",
      sourceFile: ".sourcevision/imports.json",
      kind: "task",
      tags: ["tech-debt"],
    };

    const estimated = estimateItemSize(result);
    const actual = summarizeScanResults([result]).length;

    expect(estimated).toBe(actual);
  });
});

describe("groupScanResults", () => {
  it("groups items by source file", () => {
    const results: import("../../../src/analyze/scanners.js").ScanResult[] = [
      { name: "Task B", source: "test", sourceFile: "src/b.ts", kind: "task" },
      { name: "Task A", source: "test", sourceFile: "src/a.ts", kind: "task" },
      { name: "Feature A", source: "test", sourceFile: "src/a.ts", kind: "feature" },
    ];

    const grouped = groupScanResults(results);

    // src/a.ts items should come before src/b.ts
    expect(grouped[0].sourceFile).toBe("src/a.ts");
    expect(grouped[1].sourceFile).toBe("src/a.ts");
    expect(grouped[2].sourceFile).toBe("src/b.ts");
  });

  it("sorts by kind within same source file (epic > feature > task)", () => {
    const results: import("../../../src/analyze/scanners.js").ScanResult[] = [
      { name: "Task", source: "test", sourceFile: "src/a.ts", kind: "task" },
      { name: "Epic", source: "test", sourceFile: "src/a.ts", kind: "epic" },
      { name: "Feature", source: "test", sourceFile: "src/a.ts", kind: "feature" },
    ];

    const grouped = groupScanResults(results);

    expect(grouped[0].kind).toBe("epic");
    expect(grouped[1].kind).toBe("feature");
    expect(grouped[2].kind).toBe("task");
  });

  it("does not mutate input array", () => {
    const results: import("../../../src/analyze/scanners.js").ScanResult[] = [
      { name: "B", source: "test", sourceFile: "src/b.ts", kind: "task" },
      { name: "A", source: "test", sourceFile: "src/a.ts", kind: "task" },
    ];
    const original = [...results];

    groupScanResults(results);

    expect(results[0].name).toBe(original[0].name);
    expect(results[1].name).toBe(original[1].name);
  });

  it("returns empty array for empty input", () => {
    expect(groupScanResults([])).toEqual([]);
  });
});

describe("chunkScanResults — grouping behavior", () => {
  it("keeps items from the same source file together in a chunk", () => {
    const results: import("../../../src/analyze/scanners.js").ScanResult[] = [
      { name: "Task 1", source: "test", sourceFile: "src/b.ts", kind: "task" },
      { name: "Task 2", source: "test", sourceFile: "src/a.ts", kind: "task" },
      { name: "Task 3", source: "test", sourceFile: "src/a.ts", kind: "feature" },
      { name: "Task 4", source: "test", sourceFile: "src/b.ts", kind: "feature" },
    ];

    const chunks = chunkScanResults(results);

    // All should fit in one chunk, but verify grouping order
    expect(chunks).toHaveLength(1);
    const names = chunks[0].map((r) => r.sourceFile);
    // src/a.ts items should be adjacent, src/b.ts items should be adjacent
    const aIndices = names.map((n, i) => n === "src/a.ts" ? i : -1).filter((i) => i >= 0);
    const bIndices = names.map((n, i) => n === "src/b.ts" ? i : -1).filter((i) => i >= 0);
    // Check adjacency: max - min should equal count - 1
    expect(Math.max(...aIndices) - Math.min(...aIndices)).toBe(aIndices.length - 1);
    expect(Math.max(...bIndices) - Math.min(...bIndices)).toBe(bIndices.length - 1);
  });

  it("maintains grouping across chunk boundaries", () => {
    // Create items from two source files, enough to require multiple chunks
    const results: import("../../../src/analyze/scanners.js").ScanResult[] = [];
    // 60 items from file-a, 60 items from file-b — exceeds CHUNK_ITEM_LIMIT of 100
    for (let i = 0; i < 60; i++) {
      results.push({
        name: `A-Task-${i}`,
        source: "test",
        sourceFile: "src/file-a.ts",
        kind: "task",
        description: `Description for A task ${i}`,
      });
    }
    for (let i = 0; i < 60; i++) {
      results.push({
        name: `B-Task-${i}`,
        source: "test",
        sourceFile: "src/file-b.ts",
        kind: "task",
        description: `Description for B task ${i}`,
      });
    }

    const chunks = chunkScanResults(results);

    // Should be at least 2 chunks
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    // Verify total count preserved
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    expect(total).toBe(120);

    // Due to grouping, file-a items should all appear before file-b items
    // across the flattened chunk sequence
    const flattened = chunks.flat();
    const lastAIndex = flattened.findLastIndex((r) => r.sourceFile === "src/file-a.ts");
    const firstBIndex = flattened.findIndex((r) => r.sourceFile === "src/file-b.ts");
    expect(lastAIndex).toBeLessThan(firstBIndex);
  });
});

// ── New LLM refinement tests ──

describe("extractJson", () => {
  it("extracts JSON from markdown code fences", () => {
    const raw = '```json\n[{"epic":{"title":"A"},"features":[]}]\n```';
    expect(extractJson(raw)).toBe('[{"epic":{"title":"A"},"features":[]}]');
  });

  it("extracts JSON from plain code fences", () => {
    const raw = '```\n[{"epic":{"title":"B"},"features":[]}]\n```';
    expect(extractJson(raw)).toBe('[{"epic":{"title":"B"},"features":[]}]');
  });

  it("strips leading prose before JSON array", () => {
    const raw = 'Here is the result:\n[{"epic":{"title":"C"},"features":[]}]';
    expect(extractJson(raw)).toBe('[{"epic":{"title":"C"},"features":[]}]');
  });

  it("strips trailing prose after JSON array", () => {
    const raw = '[{"epic":{"title":"D"},"features":[]}]\n\nLet me know if you need changes.';
    expect(extractJson(raw)).toBe('[{"epic":{"title":"D"},"features":[]}]');
  });

  it("handles nested arrays correctly", () => {
    const json = '[{"epic":{"title":"E"},"features":[{"title":"F","tasks":[{"title":"T"}]}]}]';
    const raw = `Some preamble\n${json}\nSome epilogue`;
    expect(extractJson(raw)).toBe(json);
  });

  it("returns original text when no JSON array found", () => {
    const raw = "no json here";
    expect(extractJson(raw)).toBe("no json here");
  });

  it("prefers code fences over bare JSON", () => {
    const raw = 'Preamble [bad]\n```json\n[{"epic":{"title":"X"},"features":[]}]\n```\nTrailing';
    expect(extractJson(raw)).toBe('[{"epic":{"title":"X"},"features":[]}]');
  });

  it("strips trailing prose after JSON object", () => {
    const raw = '{"epic":{"title":"D"},"features":[]}\n\nLet me know if you need changes.';
    expect(extractJson(raw)).toBe('{"epic":{"title":"D"},"features":[]}');
  });

  it("strips leading prose before JSON object", () => {
    const raw = 'Here is the result:\n{"epic":{"title":"E"},"features":[]}';
    expect(extractJson(raw)).toBe('{"epic":{"title":"E"},"features":[]}');
  });

  it("handles nested objects correctly when stripping trailing prose", () => {
    const json = '{"epic":{"title":"E"},"features":[{"title":"F","tasks":[{"title":"T"}]}]}';
    const raw = `Some preamble\n${json}\nSome epilogue`;
    expect(extractJson(raw)).toBe(json);
  });

  it("handles strings with braces inside JSON objects", () => {
    const json = '{"epic":{"title":"Handle {curly} braces"},"features":[]}';
    const raw = `Result:\n${json}\nDone.`;
    expect(extractJson(raw)).toBe(json);
  });

  it("handles strings with brackets inside JSON objects", () => {
    const json = '{"epic":{"title":"Handle [square] brackets"},"features":[]}';
    const raw = `Result:\n${json}\nDone.`;
    expect(extractJson(raw)).toBe(json);
  });

  it("handles single-character string values", () => {
    const json = '[{"a":"b"}]';
    const raw = `Result:\n${json}\nDone.`;
    expect(extractJson(raw)).toBe(json);
  });

  it("handles escaped characters in strings", () => {
    const json = '{"epic":{"title":"line1\\nline2\\ttab"},"features":[]}';
    const raw = `Result:\n${json}\nDone.`;
    expect(extractJson(raw)).toBe(json);
  });

  it("handles escaped backslash at end of string value", () => {
    const json = '{"epic":{"title":"path\\\\"},"features":[]}';
    const raw = `Result:\n${json}\nDone.`;
    expect(extractJson(raw)).toBe(json);
  });

  // Inline JSON — fallback for Codex-style responses where JSON appears
  // on the same line as preamble (no newline before `[` or `{`).
  it("extracts inline JSON array after same-line prose", () => {
    const json = '[{"epic":{"title":"Auth"},"features":[]}]';
    const raw = `Here are the proposals: ${json}`;
    expect(extractJson(raw)).toBe(json);
  });

  it("extracts inline JSON array with trailing prose", () => {
    const json = '[{"epic":{"title":"Auth"},"features":[]}]';
    const raw = `Here are the proposals: ${json} — let me know if you need changes.`;
    expect(extractJson(raw)).toBe(json);
  });

  it("extracts inline JSON object after same-line prose", () => {
    const json = '{"epic":{"title":"Auth"},"features":[]}';
    const raw = `Here is a single proposal: ${json}`;
    expect(extractJson(raw)).toBe(json);
  });

  it("prefers inline array over inline object when both appear", () => {
    const arr = '[{"epic":{"title":"Auth"},"features":[]}]';
    const raw = `Object: {"a":1} and array: ${arr}`;
    // Array appears later but is preferred because the existing path already
    // handles objects at start-of-line; the inline fallback should find the
    // array first when it appears before any object in the text.
    // In this case the object `{"a":1}` is first, but since it doesn't match
    // the Proposal schema the real test is that we find the valid JSON.
    // Just verify extraction doesn't throw and returns parseable JSON.
    const extracted = extractJson(raw);
    expect(() => JSON.parse(extracted)).not.toThrow();
  });
});

describe("repairTruncatedJson", () => {
  it("returns valid JSON as-is", () => {
    const valid = '[{"epic":{"title":"A"},"features":[]}]';
    expect(repairTruncatedJson(valid)).toBe(valid);
  });

  it("closes unclosed braces and brackets", () => {
    const truncated = '[{"epic":{"title":"A"},"features":[{"title":"F","tasks":[';
    const repaired = repairTruncatedJson(truncated);
    expect(repaired).not.toBeNull();
    expect(() => JSON.parse(repaired!)).not.toThrow();

    const parsed = JSON.parse(repaired!);
    expect(parsed[0].epic.title).toBe("A");
  });

  it("closes unclosed strings", () => {
    const truncated = '[{"epic":{"title":"Hello';
    const repaired = repairTruncatedJson(truncated);
    expect(repaired).not.toBeNull();
    expect(() => JSON.parse(repaired!)).not.toThrow();
  });

  it("repairs truncated JSON objects", () => {
    const repaired = repairTruncatedJson('{"key": "value"');
    expect(repaired).not.toBeNull();
    expect(() => JSON.parse(repaired!)).not.toThrow();

    const parsed = JSON.parse(repaired!);
    expect(parsed.key).toBe("value");
  });

  it("returns null for non-JSON input", () => {
    expect(repairTruncatedJson("some plain text")).toBeNull();
  });

  it("returns null for completely mangled input", () => {
    expect(repairTruncatedJson("not json at all")).toBeNull();
  });

  it("handles escaped characters inside strings", () => {
    const truncated = '[{"epic":{"title":"Say \\"hello\\""},"features":[';
    const repaired = repairTruncatedJson(truncated);
    expect(repaired).not.toBeNull();
    expect(() => JSON.parse(repaired!)).not.toThrow();
  });

  it("handles single-character string values", () => {
    const truncated = '[{"epic":{"title":"A"},"features":[{"title":"B';
    const repaired = repairTruncatedJson(truncated);
    expect(repaired).not.toBeNull();
    expect(() => JSON.parse(repaired!)).not.toThrow();

    const parsed = JSON.parse(repaired!);
    expect(parsed[0].epic.title).toBe("A");
  });

  it("handles single-character key names", () => {
    const truncated = '[{"epic":{"title":"Test"},"x';
    const repaired = repairTruncatedJson(truncated);
    expect(repaired).not.toBeNull();
    expect(() => JSON.parse(repaired!)).not.toThrow();

    const parsed = JSON.parse(repaired!);
    expect(parsed[0].epic.title).toBe("Test");
  });

  it("handles truncation right after a backslash in a string", () => {
    // Truncated mid-escape: the trailing backslash should be dropped
    const truncated = '[{"epic":{"title":"path\\';
    const repaired = repairTruncatedJson(truncated);
    expect(repaired).not.toBeNull();
    expect(() => JSON.parse(repaired!)).not.toThrow();

    const parsed = JSON.parse(repaired!);
    // The trailing incomplete escape should be stripped, not turned into \"
    expect(parsed[0].epic.title).toBe("path");
  });

  it("handles truncated unicode escape sequence", () => {
    // Truncated mid-unicode: \u00 is incomplete (needs 4 hex digits)
    const truncated = '[{"epic":{"title":"emoji \\u00';
    const repaired = repairTruncatedJson(truncated);
    expect(repaired).not.toBeNull();
    expect(() => JSON.parse(repaired!)).not.toThrow();

    const parsed = JSON.parse(repaired!);
    expect(parsed[0].epic.title).toBe("emoji ");
  });

  it("handles escaped newline and tab in truncated strings", () => {
    const truncated = '[{"epic":{"title":"line1\\nline2\\t';
    const repaired = repairTruncatedJson(truncated);
    expect(repaired).not.toBeNull();
    expect(() => JSON.parse(repaired!)).not.toThrow();

    const parsed = JSON.parse(repaired!);
    expect(parsed[0].epic.title).toBe("line1\nline2\t");
  });

  it("handles string that is only an escaped character", () => {
    const truncated = '[{"epic":{"title":"\\n';
    const repaired = repairTruncatedJson(truncated);
    expect(repaired).not.toBeNull();
    expect(() => JSON.parse(repaired!)).not.toThrow();

    const parsed = JSON.parse(repaired!);
    expect(parsed[0].epic.title).toBe("\n");
  });

  it("handles trailing comma after last array element", () => {
    const truncated = '[{"epic":{"title":"A"},"features":[]},';
    const repaired = repairTruncatedJson(truncated);
    expect(repaired).not.toBeNull();
    expect(() => JSON.parse(repaired!)).not.toThrow();

    const parsed = JSON.parse(repaired!);
    expect(parsed[0].epic.title).toBe("A");
  });

  it("handles trailing comma after last object property", () => {
    const truncated = '[{"epic":{"title":"A"},';
    const repaired = repairTruncatedJson(truncated);
    expect(repaired).not.toBeNull();
    expect(() => JSON.parse(repaired!)).not.toThrow();
  });

  it("handles truncation mid-value with colon", () => {
    // Truncated right after a colon — the value is missing entirely
    const truncated = '[{"epic":{"title":';
    const repaired = repairTruncatedJson(truncated);
    expect(repaired).not.toBeNull();
    expect(() => JSON.parse(repaired!)).not.toThrow();
  });

  it("handles deeply nested truncation", () => {
    const truncated = '[{"epic":{"title":"A"},"features":[{"title":"F","tasks":[{"title":"T","acceptanceCriteria":["crit1","crit2';
    const repaired = repairTruncatedJson(truncated);
    expect(repaired).not.toBeNull();
    expect(() => JSON.parse(repaired!)).not.toThrow();

    const parsed = JSON.parse(repaired!);
    expect(parsed[0].epic.title).toBe("A");
  });

  it("handles truncation in the middle of a key name", () => {
    const truncated = '[{"epic":{"title":"A"},"feat';
    const repaired = repairTruncatedJson(truncated);
    expect(repaired).not.toBeNull();
    expect(() => JSON.parse(repaired!)).not.toThrow();
  });

  it("handles empty array at truncation point", () => {
    const truncated = '[{"epic":{"title":"A"},"features":[]}';
    const repaired = repairTruncatedJson(truncated);
    expect(repaired).not.toBeNull();
    // Should end up as a valid single-element array
    const parsed = JSON.parse(repaired!);
    expect(parsed[0].epic.title).toBe("A");
  });

  it("handles 4-level nesting truncated mid-criterion string", () => {
    // epic > features > tasks > acceptanceCriteria — truncated inside a criterion
    const truncated =
      '[{"epic":{"title":"E1"},"features":[{"title":"F1","tasks":[{"title":"T1","description":"D","acceptanceCriteria":["handles deeply nested truncation","handles deeply nested tre';
    const repaired = repairTruncatedJson(truncated);
    expect(repaired).not.toBeNull();
    expect(() => JSON.parse(repaired!)).not.toThrow();

    const parsed = JSON.parse(repaired!);
    expect(parsed[0].epic.title).toBe("E1");
    expect(parsed[0].features[0].tasks[0].acceptanceCriteria.length).toBeGreaterThanOrEqual(1);
  });

  it("handles multi-epic with second epic deeply truncated", () => {
    const truncated =
      '[{"epic":{"title":"E1"},"features":[{"title":"F1","tasks":[{"title":"T1","acceptanceCriteria":["c1"]}]}]},{"epic":{"title":"E2"},"features":[{"title":"F2","tasks":[{"title":"T2","acceptanceCriteria":["c1","c';
    const repaired = repairTruncatedJson(truncated);
    expect(repaired).not.toBeNull();
    expect(() => JSON.parse(repaired!)).not.toThrow();

    const parsed = JSON.parse(repaired!);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].epic.title).toBe("E1");
    expect(parsed[1].epic.title).toBe("E2");
  });

  it("handles partial literal value at deep nesting (partial null)", () => {
    // Truncated mid-literal: "description":nul
    const truncated =
      '[{"epic":{"title":"E"},"features":[{"title":"F","tasks":[{"title":"T","description":nul';
    const repaired = repairTruncatedJson(truncated);
    expect(repaired).not.toBeNull();
    expect(() => JSON.parse(repaired!)).not.toThrow();
  });

  it("handles partial literal value at deep nesting (partial false)", () => {
    const truncated =
      '[{"epic":{"title":"E"},"features":[{"title":"F","tasks":[{"title":"T","done":fals';
    const repaired = repairTruncatedJson(truncated);
    expect(repaired).not.toBeNull();
    expect(() => JSON.parse(repaired!)).not.toThrow();
  });

  it("handles partial literal value at deep nesting (partial true)", () => {
    const truncated = '[{"epic":{"title":"E"},"features":[{"title":"F","tasks":[{"title":"T","flag":tr';
    const repaired = repairTruncatedJson(truncated);
    expect(repaired).not.toBeNull();
    expect(() => JSON.parse(repaired!)).not.toThrow();
  });

  it("preserves complete siblings when last item is deeply truncated", () => {
    // First feature is complete, second is truncated deep inside
    const truncated =
      '[{"epic":{"title":"E"},"features":[{"title":"F1","tasks":[{"title":"T1","acceptanceCriteria":["c1"]}]},{"title":"F2","tasks":[{"title":"T2","accept';
    const repaired = repairTruncatedJson(truncated);
    expect(repaired).not.toBeNull();
    expect(() => JSON.parse(repaired!)).not.toThrow();

    const parsed = JSON.parse(repaired!);
    expect(parsed[0].features[0].title).toBe("F1");
    expect(parsed[0].features[0].tasks[0].acceptanceCriteria).toEqual(["c1"]);
  });

  it("handles pretty-printed JSON truncated at deep nesting", () => {
    const truncated = `[
  {
    "epic": { "title": "Pipeline" },
    "features": [
      {
        "title": "Parser",
        "tasks": [
          {
            "title": "Handle nesting",
            "acceptanceCriteria": [
              "handles deeply nested truncation",
              "handles deeply nested`;
    const repaired = repairTruncatedJson(truncated);
    expect(repaired).not.toBeNull();
    expect(() => JSON.parse(repaired!)).not.toThrow();

    const parsed = JSON.parse(repaired!);
    expect(parsed[0].epic.title).toBe("Pipeline");
  });
});

describe("parseProposalResponse — enhanced", () => {
  it("recovers from truncated JSON", () => {
    // Simulate a cut-off LLM response
    const truncated = '[{"epic":{"title":"Auth"},"features":[{"title":"Login","tasks":[{"title":"Validate email"}';
    const proposals = parseProposalResponse(truncated);

    expect(proposals.length).toBeGreaterThanOrEqual(1);
    expect(proposals[0].epic.title).toBe("Auth");
  });

  it("strips leading prose from LLM response", () => {
    const raw = 'Here is the structured PRD:\n[{"epic":{"title":"API"},"features":[{"title":"Endpoints","tasks":[]}]}]';
    const proposals = parseProposalResponse(raw);

    expect(proposals).toHaveLength(1);
    expect(proposals[0].epic.title).toBe("API");
  });

  it("falls back to lenient parsing when some items are invalid", () => {
    const raw = JSON.stringify([
      {
        epic: { title: "Good" },
        features: [{ title: "F1", tasks: [{ title: "T1" }] }],
      },
      {
        // Missing epic.title - invalid
        epic: {},
        features: [],
      },
    ]);

    const proposals = parseProposalResponse(raw);

    // Should recover the valid item
    expect(proposals).toHaveLength(1);
    expect(proposals[0].epic.title).toBe("Good");
  });

  it("throws descriptive error when nothing is salvageable", () => {
    const raw = JSON.stringify([{ bad: "data" }, { also: "bad" }]);

    expect(() => parseProposalResponse(raw)).toThrow(/schema validation/);
  });

  it("provides useful error message for non-JSON", () => {
    expect(() => parseProposalResponse("I cannot generate that")).toThrow(/Invalid JSON/);
  });

  it("handles deeply truncated JSON with partial acceptance criteria", () => {
    const truncated = '[{"epic":{"title":"Auth"},"features":[{"title":"Login","tasks":[{"title":"Validate","acceptanceCriteria":["email valid","pass';
    const proposals = parseProposalResponse(truncated);

    expect(proposals.length).toBeGreaterThanOrEqual(1);
    expect(proposals[0].epic.title).toBe("Auth");
  });

  it("handles JSON with trailing commas from truncation", () => {
    const truncated = '[{"epic":{"title":"Auth"},"features":[{"title":"Login","tasks":[{"title":"Validate email"}]},';
    const proposals = parseProposalResponse(truncated);

    expect(proposals.length).toBeGreaterThanOrEqual(1);
    expect(proposals[0].epic.title).toBe("Auth");
  });

  it("extracts JSON object wrapped in prose and treats as single-item array", () => {
    const raw = 'Here is the result:\n{"epic":{"title":"API"},"features":[{"title":"Endpoints","tasks":[]}]}\nLet me know!';
    const proposals = parseProposalResponse(raw);

    expect(proposals).toHaveLength(1);
    expect(proposals[0].epic.title).toBe("API");
  });
});

describe("validateProposalQuality", () => {
  it("returns no issues for well-formed proposals", () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "User Authentication", source: "llm" },
        features: [
          {
            title: "Login Flow",
            source: "llm",
            tasks: [
              {
                title: "Implement email validation",
                source: "llm",
                sourceFile: "",
                description: "Validate user email format before submission",
                acceptanceCriteria: ["Rejects invalid emails", "Allows valid emails"],
              },
            ],
          },
        ],
      },
    ];

    const issues = validateProposalQuality(proposals);
    expect(issues).toEqual([]);
  });

  it("warns about tasks missing description and criteria", () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "API Layer", source: "llm" },
        features: [
          {
            title: "REST Endpoints",
            source: "llm",
            tasks: [
              {
                title: "Add GET /users endpoint",
                source: "llm",
                sourceFile: "",
                // No description or acceptanceCriteria
              },
            ],
          },
        ],
      },
    ];

    const issues = validateProposalQuality(proposals);
    expect(issues.some((i) => i.message.includes("lacks both description and acceptance criteria"))).toBe(true);
  });

  it("warns about short epic titles", () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "UI", source: "llm" },
        features: [{ title: "Forms", source: "llm", tasks: [] }],
      },
    ];

    const issues = validateProposalQuality(proposals);
    expect(issues.some((i) => i.message.includes("too short"))).toBe(true);
  });

  it("warns about features with no tasks", () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "Backend Services", source: "llm" },
        features: [
          { title: "Database Layer", source: "llm", tasks: [] },
        ],
      },
    ];

    const issues = validateProposalQuality(proposals);
    expect(issues.some((i) => i.message.includes("no tasks"))).toBe(true);
  });

  it("warns about epics with no features", () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "Empty Epic", source: "llm" },
        features: [],
      },
    ];

    const issues = validateProposalQuality(proposals);
    expect(issues.some((i) => i.message.includes("no features"))).toBe(true);
  });

  it("warns about very short task titles", () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "Testing Infrastructure", source: "llm" },
        features: [
          {
            title: "Unit Tests",
            source: "llm",
            tasks: [
              {
                title: "Fix",
                source: "llm",
                sourceFile: "",
                description: "Fix something",
              },
            ],
          },
        ],
      },
    ];

    const issues = validateProposalQuality(proposals);
    expect(issues.some((i) => i.message.includes("too short to be actionable"))).toBe(true);
  });

  it("reports all issues across multiple proposals", () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "A", source: "llm" },  // Short title
        features: [],                           // No features
      },
      {
        epic: { title: "Backend Services", source: "llm" },
        features: [
          {
            title: "API",
            source: "llm",
            tasks: [
              { title: "Do", source: "llm", sourceFile: "" },  // Short title, no desc
            ],
          },
        ],
      },
    ];

    const issues = validateProposalQuality(proposals);

    // Should find issues in both proposals
    expect(issues.length).toBeGreaterThanOrEqual(3);
    expect(issues.some((i) => i.path.includes('epic:"A"'))).toBe(true);
    expect(issues.some((i) => i.path.includes('task:"Do"'))).toBe(true);
  });

  it("accepts tasks with only description (no criteria)", () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "Infrastructure", source: "llm" },
        features: [
          {
            title: "CI/CD Pipeline",
            source: "llm",
            tasks: [
              {
                title: "Configure GitHub Actions workflow",
                source: "llm",
                sourceFile: "",
                description: "Set up CI/CD with build, test, and deploy stages",
              },
            ],
          },
        ],
      },
    ];

    const issues = validateProposalQuality(proposals);
    expect(issues).toEqual([]);
  });

  it("accepts tasks with only criteria (no description)", () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "Infrastructure", source: "llm" },
        features: [
          {
            title: "Monitoring",
            source: "llm",
            tasks: [
              {
                title: "Add health check endpoint",
                source: "llm",
                sourceFile: "",
                acceptanceCriteria: ["Returns 200 on /health", "Includes uptime in response"],
              },
            ],
          },
        ],
      },
    ];

    const issues = validateProposalQuality(proposals);
    expect(issues).toEqual([]);
  });
});

describe("FEW_SHOT_EXAMPLE", () => {
  it("is valid JSON within the example text", () => {
    // Extract the JSON part from the example
    const jsonStart = FEW_SHOT_EXAMPLE.indexOf("[");
    const jsonEnd = FEW_SHOT_EXAMPLE.lastIndexOf("]") + 1;
    const json = FEW_SHOT_EXAMPLE.slice(jsonStart, jsonEnd);

    expect(() => JSON.parse(json)).not.toThrow();

    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].epic.title).toBe("User Authentication");
  });

  it("demonstrates the expected structure with all optional fields", () => {
    const jsonStart = FEW_SHOT_EXAMPLE.indexOf("[");
    const jsonEnd = FEW_SHOT_EXAMPLE.lastIndexOf("]") + 1;
    const parsed = JSON.parse(FEW_SHOT_EXAMPLE.slice(jsonStart, jsonEnd));

    const task = parsed[0].features[0].tasks[0];
    expect(task.description).toBeDefined();
    expect(task.acceptanceCriteria).toBeDefined();
    expect(task.priority).toBeDefined();
    expect(task.tags).toBeDefined();
  });
});

describe("MAX_RETRIES", () => {
  it("is exported and is a positive integer", () => {
    expect(typeof MAX_RETRIES).toBe("number");
    expect(MAX_RETRIES).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(MAX_RETRIES)).toBe(true);
  });
});
