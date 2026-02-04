import { describe, it, expect } from "vitest";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseProposalResponse,
  detectFileFormat,
  parseStructuredFile,
} from "../../../src/analyze/reason.js";

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
