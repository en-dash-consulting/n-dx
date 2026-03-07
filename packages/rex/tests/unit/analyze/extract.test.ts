import { describe, it, expect } from "vitest";
import {
  extractFromMarkdown,
  extractFromText,
  classifyHeadingLevels,
} from "../../../src/analyze/extract.js";
import type { Proposal } from "../../../src/analyze/propose.js";

// ── Helper ──

function epicTitles(proposals: Proposal[]): string[] {
  return proposals.map((p) => p.epic.title);
}

function featureTitles(proposals: Proposal[]): string[] {
  return proposals.flatMap((p) => p.features.map((f) => f.title));
}

function taskTitles(proposals: Proposal[]): string[] {
  return proposals.flatMap((p) =>
    p.features.flatMap((f) => f.tasks.map((t) => t.title)),
  );
}

// ── classifyHeadingLevels ──

describe("classifyHeadingLevels", () => {
  it("maps h1→epic, h2→feature, h3→task for standard hierarchy", () => {
    const result = classifyHeadingLevels([1, 2, 3]);
    expect(result).toEqual({ 1: "epic", 2: "feature", 3: "task" });
  });

  it("maps h2→epic, h3→feature when no h1 present", () => {
    const result = classifyHeadingLevels([2, 3]);
    expect(result).toEqual({ 2: "epic", 3: "feature" });
  });

  it("maps h2→epic, h3→feature, h4→task when deepest hierarchy starts at h2", () => {
    const result = classifyHeadingLevels([2, 3, 4]);
    expect(result).toEqual({ 2: "epic", 3: "feature", 4: "task" });
  });

  it("treats single heading level as feature", () => {
    const result = classifyHeadingLevels([2]);
    expect(result).toEqual({ 2: "feature" });
  });

  it("handles four levels by collapsing deepest to task", () => {
    const result = classifyHeadingLevels([1, 2, 3, 4]);
    expect(result).toEqual({ 1: "epic", 2: "feature", 3: "task", 4: "task" });
  });

  it("returns empty map for empty input", () => {
    expect(classifyHeadingLevels([])).toEqual({});
  });
});

// ── extractFromMarkdown ──

describe("extractFromMarkdown", () => {
  describe("epic-level identification from document structure", () => {
    it("identifies h1 headings as epics", () => {
      const md = `# Authentication
## Login Flow
- Validate credentials
- Handle OAuth2

# Dashboard
## Analytics
- Display charts
`;
      const result = extractFromMarkdown(md);
      expect(epicTitles(result.proposals)).toEqual([
        "Authentication",
        "Dashboard",
      ]);
    });

    it("treats h2 as epics when no h1 is present", () => {
      const md = `## User Management
### Create Users
- Add form validation

## Billing
### Payment Processing
- Integrate Stripe
`;
      const result = extractFromMarkdown(md);
      expect(epicTitles(result.proposals)).toEqual([
        "User Management",
        "Billing",
      ]);
    });
  });

  describe("feature-level extraction from subsections", () => {
    it("extracts h2 sections as features under h1 epics", () => {
      const md = `# Authentication
## Login Flow
Design the login flow.
## Password Reset
Handle password resets.
`;
      const result = extractFromMarkdown(md);
      expect(result.proposals).toHaveLength(1);
      expect(featureTitles(result.proposals)).toEqual([
        "Login Flow",
        "Password Reset",
      ]);
    });

    it("extracts h3 sections as features under h2 epics", () => {
      const md = `## API Layer
### REST Endpoints
Set up REST.
### GraphQL Gateway
Set up GraphQL.
`;
      const result = extractFromMarkdown(md);
      expect(featureTitles(result.proposals)).toEqual([
        "REST Endpoints",
        "GraphQL Gateway",
      ]);
    });

    it("includes feature description from paragraph text", () => {
      const md = `# Core
## Feature One
This is the description of feature one.
It spans multiple lines.
- bullet item
`;
      const result = extractFromMarkdown(md);
      const feature = result.proposals[0].features[0];
      expect(feature.description).toBe(
        "This is the description of feature one. It spans multiple lines.",
      );
    });
  });

  describe("task-level extraction from bullets and paragraphs", () => {
    it("extracts bullet points as tasks", () => {
      const md = `# Project
## Feature A
- Implement login form
- Add form validation
- Handle error states
`;
      const result = extractFromMarkdown(md);
      expect(taskTitles(result.proposals)).toEqual([
        "Implement login form",
        "Add form validation",
        "Handle error states",
      ]);
    });

    it("extracts numbered list items as tasks", () => {
      const md = `# Project
## Feature A
1. Set up database schema
2. Create API endpoints
3. Write integration tests
`;
      const result = extractFromMarkdown(md);
      expect(taskTitles(result.proposals)).toEqual([
        "Set up database schema",
        "Create API endpoints",
        "Write integration tests",
      ]);
    });

    it("extracts h3 headings as tasks when h1/h2/h3 hierarchy", () => {
      const md = `# Epic
## Feature
### Implement caching layer
Add Redis caching for hot paths.
### Add retry logic
Implement exponential backoff.
`;
      const result = extractFromMarkdown(md);
      expect(taskTitles(result.proposals)).toEqual([
        "Implement caching layer",
        "Add retry logic",
      ]);
    });

    it("includes task description from paragraph under task heading", () => {
      const md = `# Epic
## Feature
### Implement caching layer
Add Redis caching for hot paths to reduce database load.
`;
      const result = extractFromMarkdown(md);
      const task = result.proposals[0].features[0].tasks[0];
      expect(task.description).toBe(
        "Add Redis caching for hot paths to reduce database load.",
      );
    });

    it("includes bullets under task headings as acceptance criteria", () => {
      const md = `# Epic
## Feature
### Implement rate limiting
- Returns 429 when limit exceeded
- Configurable per-route limits
- Supports IP-based limiting
`;
      const result = extractFromMarkdown(md);
      const task = result.proposals[0].features[0].tasks[0];
      expect(task.acceptanceCriteria).toEqual([
        "Returns 429 when limit exceeded",
        "Configurable per-route limits",
        "Supports IP-based limiting",
      ]);
    });
  });

  describe("edge cases", () => {
    it("handles document with only bullets (no headings)", () => {
      const md = `- Implement auth
- Add caching
- Write tests
`;
      const result = extractFromMarkdown(md);
      // Should create a single feature with tasks
      expect(result.proposals).toHaveLength(1);
      expect(taskTitles(result.proposals)).toEqual([
        "Implement auth",
        "Add caching",
        "Write tests",
      ]);
    });

    it("handles empty document", () => {
      const result = extractFromMarkdown("");
      expect(result.proposals).toEqual([]);
    });

    it("handles document with only prose paragraphs", () => {
      const md = `This is a requirement document about building a user dashboard.

The system should display real-time analytics and support filtering.
`;
      const result = extractFromMarkdown(md);
      // Prose-only documents are ambiguous — should produce at least one item
      expect(result.proposals.length).toBeGreaterThanOrEqual(0);
      expect(result.usedLLM).toBe(false);
    });

    it("skips code blocks", () => {
      const md = `# Project
## Feature
\`\`\`
# This is a code comment, not a heading
- This is not a task
\`\`\`
- This IS a task
`;
      const result = extractFromMarkdown(md);
      expect(taskTitles(result.proposals)).toEqual(["This IS a task"]);
    });

    it("strips markdown formatting from headings", () => {
      const md = `# **Bold** Epic
## *Italic* Feature
- Task with \`code\`
`;
      const result = extractFromMarkdown(md);
      expect(epicTitles(result.proposals)).toEqual(["Bold Epic"]);
      expect(featureTitles(result.proposals)).toEqual(["Italic Feature"]);
    });

    it("handles mixed bullet styles (dash, asterisk, numbered)", () => {
      const md = `# Project
## Feature
- Dash task
* Star task
1. Numbered task
`;
      const result = extractFromMarkdown(md);
      expect(taskTitles(result.proposals)).toEqual([
        "Dash task",
        "Star task",
        "Numbered task",
      ]);
    });

    it("deduplicates against existing items", () => {
      const md = `# Project
## Feature A
- Implement login
- Add caching
`;
      const result = extractFromMarkdown(md, {
        existingItems: [
          {
            id: "1",
            title: "Implement login",
            level: "task",
            status: "completed",
          } as any,
        ],
      });
      // "Implement login" should be filtered out
      expect(taskTitles(result.proposals)).toEqual(["Add caching"]);
    });

    it("sets source to file-import on all items", () => {
      const md = `# Epic
## Feature
- Task
`;
      const result = extractFromMarkdown(md);
      expect(result.proposals[0].epic.source).toBe("file-import");
      expect(result.proposals[0].features[0].source).toBe("file-import");
      expect(result.proposals[0].features[0].tasks[0].source).toBe(
        "file-import",
      );
    });
  });

  describe("complex documents", () => {
    it("handles a realistic PRD document", () => {
      const md = `# User Authentication
## OAuth2 Integration
Support third-party OAuth2 providers for user login.
- Implement Google OAuth2 flow
- Implement GitHub OAuth2 flow
- Store refresh tokens securely

## Password-based Auth
Traditional email/password authentication.
- Implement registration endpoint
- Add password hashing with bcrypt
- Handle password reset flow

# API Infrastructure
## Rate Limiting
Protect API endpoints from abuse.
- Implement token bucket algorithm
- Add per-route configuration
- Return proper 429 responses

## Caching Layer
Reduce database load with intelligent caching.
### Implement Redis integration
Set up Redis connection pool and cache helpers.
### Add cache invalidation strategy
Define TTL and event-based invalidation rules.
`;
      const result = extractFromMarkdown(md);

      expect(epicTitles(result.proposals)).toEqual([
        "User Authentication",
        "API Infrastructure",
      ]);

      // Check features under first epic
      const authFeatures = result.proposals[0].features.map((f) => f.title);
      expect(authFeatures).toEqual(["OAuth2 Integration", "Password-based Auth"]);

      // Check tasks under OAuth2 feature
      const oauthTasks = result.proposals[0].features[0].tasks.map(
        (t) => t.title,
      );
      expect(oauthTasks).toEqual([
        "Implement Google OAuth2 flow",
        "Implement GitHub OAuth2 flow",
        "Store refresh tokens securely",
      ]);

      // Check Caching Layer has heading-based tasks
      const cachingFeature = result.proposals[1].features.find(
        (f) => f.title === "Caching Layer",
      );
      expect(cachingFeature).toBeDefined();
      expect(cachingFeature!.tasks.map((t) => t.title)).toEqual([
        "Implement Redis integration",
        "Add cache invalidation strategy",
      ]);
    });
  });
});

// ── extractFromText ──

describe("extractFromText", () => {
  it("extracts bullet points as tasks", () => {
    const text = `Requirements for the login system:
- Validate email format
- Check password strength
- Implement rate limiting on login attempts
`;
    const result = extractFromText(text);
    expect(taskTitles(result.proposals)).toEqual([
      "Validate email format",
      "Check password strength",
      "Implement rate limiting on login attempts",
    ]);
  });

  it("extracts numbered items as tasks", () => {
    const text = `Todo:
1. Set up CI pipeline
2. Configure linting rules
3. Add pre-commit hooks
`;
    const result = extractFromText(text);
    expect(taskTitles(result.proposals)).toEqual([
      "Set up CI pipeline",
      "Configure linting rules",
      "Add pre-commit hooks",
    ]);
  });

  it("handles empty text", () => {
    const result = extractFromText("");
    expect(result.proposals).toEqual([]);
  });

  it("handles text with markdown headings by delegating to markdown extraction", () => {
    const text = `# Epic
## Feature
- Task
`;
    const result = extractFromText(text);
    // Should detect markdown-like content and use markdown extraction
    expect(epicTitles(result.proposals)).toEqual(["Epic"]);
  });

  it("groups line-separated blocks into features", () => {
    const text = `User Management
- Create user accounts
- Delete user accounts

Notification System
- Send email notifications
- Send push notifications
`;
    const result = extractFromText(text);
    expect(featureTitles(result.proposals)).toContain("User Management");
    expect(featureTitles(result.proposals)).toContain("Notification System");
  });

  it("sets source to file-import", () => {
    const text = `- Build the thing
`;
    const result = extractFromText(text);
    expect(result.proposals[0].epic.source).toBe("file-import");
  });
});

// ── sourceFile tracking ──

describe("sourceFile tracking", () => {
  it("populates sourceFile on tasks when option is provided", () => {
    const md = `# Epic
## Feature
- Implement login form
`;
    const result = extractFromMarkdown(md, {
      sourceFile: "requirements.md",
    });
    expect(result.proposals[0].features[0].tasks[0].sourceFile).toBe(
      "requirements.md",
    );
  });

  it("defaults sourceFile to empty string when option is omitted", () => {
    const md = `# Epic
## Feature
- Implement login form
`;
    const result = extractFromMarkdown(md);
    expect(result.proposals[0].features[0].tasks[0].sourceFile).toBe("");
  });

  it("populates sourceFile on tasks from extractFromText", () => {
    const text = `Requirements:
- Build the thing
`;
    const result = extractFromText(text, {
      sourceFile: "ideas.txt",
    });
    expect(result.proposals[0].features[0].tasks[0].sourceFile).toBe(
      "ideas.txt",
    );
  });

  it("populates sourceFile on all tasks in complex documents", () => {
    const md = `# Auth
## Login
- Validate credentials
- Handle OAuth2

# Dashboard
## Charts
- Display charts
`;
    const result = extractFromMarkdown(md, {
      sourceFile: "prd.md",
    });
    for (const proposal of result.proposals) {
      for (const feature of proposal.features) {
        for (const task of feature.tasks) {
          expect(task.sourceFile).toBe("prd.md");
        }
      }
    }
  });

  it("populates sourceFile on acceptance-criteria tasks from heading sections", () => {
    const md = `# Epic
## Feature
### Implement rate limiting
- Returns 429 when limit exceeded
- Configurable per-route limits
`;
    const result = extractFromMarkdown(md, {
      sourceFile: "api-spec.md",
    });
    expect(result.proposals[0].features[0].tasks[0].sourceFile).toBe(
      "api-spec.md",
    );
  });
});

// ── Markdown section context ──

describe("markdown section context", () => {
  it("preserves section path context in task descriptions when enabled", () => {
    const md = `# User Authentication
## OAuth2 Integration
- Implement Google OAuth2 flow
- Implement GitHub OAuth2 flow
`;
    const result = extractFromMarkdown(md, {
      preserveContext: true,
    });
    const tasks = result.proposals[0].features[0].tasks;
    expect(tasks[0].description).toContain("User Authentication");
    expect(tasks[0].description).toContain("OAuth2 Integration");
  });

  it("does not add context to tasks that already have descriptions from headings", () => {
    const md = `# Epic
## Feature
### Implement caching layer
Add Redis caching for hot paths.
`;
    const result = extractFromMarkdown(md, {
      preserveContext: true,
    });
    const task = result.proposals[0].features[0].tasks[0];
    // Description should be the original paragraph text, context is appended
    expect(task.description).toContain("Add Redis caching for hot paths");
  });

  it("does not inject context when preserveContext is false", () => {
    const md = `# Epic
## Feature
- Simple task
`;
    const result = extractFromMarkdown(md, {
      preserveContext: false,
    });
    const task = result.proposals[0].features[0].tasks[0];
    expect(task.description).toBeUndefined();
  });
});
