import { describe, it, expect } from "vitest";
import {
  extractFromText,
  classifyHeadingLevels,
  isAllCapsHeader,
  isRequirementSentence,
  extractRequirementSentences,
  parseNumberedSection,
} from "../../../src/analyze/extract.js";
import type { Proposal } from "../../../src/analyze/propose.js";

// ── Helpers ──

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

// ── isAllCapsHeader ──

describe("isAllCapsHeader", () => {
  it("detects multi-word ALL CAPS lines", () => {
    expect(isAllCapsHeader("USER AUTHENTICATION")).toBe(true);
    expect(isAllCapsHeader("API INFRASTRUCTURE")).toBe(true);
    expect(isAllCapsHeader("RATE LIMITING")).toBe(true);
  });

  it("detects long single-word ALL CAPS (6+ chars)", () => {
    expect(isAllCapsHeader("AUTHENTICATION")).toBe(true);
    expect(isAllCapsHeader("INFRASTRUCTURE")).toBe(true);
  });

  it("rejects short single-word ALL CAPS", () => {
    expect(isAllCapsHeader("API")).toBe(false);
    expect(isAllCapsHeader("UI")).toBe(false);
  });

  it("rejects lines with lowercase letters", () => {
    expect(isAllCapsHeader("User Authentication")).toBe(false);
    expect(isAllCapsHeader("ALL caps Except This")).toBe(false);
  });

  it("rejects empty or whitespace-only lines", () => {
    expect(isAllCapsHeader("")).toBe(false);
    expect(isAllCapsHeader("   ")).toBe(false);
  });

  it("handles ALL CAPS with numbers", () => {
    expect(isAllCapsHeader("PHASE 2 REQUIREMENTS")).toBe(true);
    expect(isAllCapsHeader("V2 API DESIGN")).toBe(true);
  });
});

// ── isRequirementSentence ──

describe("isRequirementSentence", () => {
  it("detects RFC 2119 keywords", () => {
    expect(isRequirementSentence("The system must validate input")).toBe(true);
    expect(isRequirementSentence("Users should be able to log in")).toBe(true);
    expect(isRequirementSentence("The application shall support SSO")).toBe(true);
    expect(isRequirementSentence("The service will handle retries")).toBe(true);
  });

  it("detects action-oriented phrases", () => {
    expect(isRequirementSentence("Implement OAuth2 flow")).toBe(true);
    expect(isRequirementSentence("Support multiple languages")).toBe(true);
    expect(isRequirementSentence("Enable dark mode for all views")).toBe(true);
    expect(isRequirementSentence("Handle network timeouts gracefully")).toBe(true);
  });

  it("detects requirement patterns with subject", () => {
    expect(isRequirementSentence("The system must handle 1000 requests per second")).toBe(true);
    expect(isRequirementSentence("Users can reset their password via email")).toBe(true);
  });

  it("rejects non-requirement text", () => {
    expect(isRequirementSentence("This is a general observation")).toBe(false);
    expect(isRequirementSentence("The meeting was productive")).toBe(false);
  });
});

// ── extractRequirementSentences ──

describe("extractRequirementSentences", () => {
  it("extracts requirement sentences from prose", () => {
    const text =
      "The system must validate all user input. " +
      "This is a general note about the project. " +
      "Users should be able to reset their passwords.";
    const result = extractRequirementSentences(text);
    expect(result).toContain("The system must validate all user input");
    expect(result).toContain("Users should be able to reset their passwords");
  });

  it("filters out very long sentences", () => {
    const longSentence = "The system must " + "do something ".repeat(20) + "important.";
    const result = extractRequirementSentences(longSentence);
    expect(result).toEqual([]);
  });

  it("trims trailing periods", () => {
    const text = "The system must validate input.";
    const result = extractRequirementSentences(text);
    expect(result[0]).not.toMatch(/\.$/);
  });

  it("handles text with abbreviations", () => {
    const text = "Support formats e.g. JSON and YAML. The system must handle errors.";
    const result = extractRequirementSentences(text);
    expect(result.length).toBeGreaterThan(0);
  });
});

// ── parseNumberedSection ──

describe("parseNumberedSection", () => {
  it("parses hierarchical numbered sections", () => {
    expect(parseNumberedSection("1.1 Authentication")).toEqual({
      text: "Authentication",
      depth: 1,
    });
    expect(parseNumberedSection("2.3.1 Rate Limiting")).toEqual({
      text: "Rate Limiting",
      depth: 2,
    });
  });

  it("does not match simple numbered list items", () => {
    expect(parseNumberedSection("1. Set up CI pipeline")).toBeNull();
    expect(parseNumberedSection("2. Configure linting")).toBeNull();
    expect(parseNumberedSection("10. Write tests")).toBeNull();
  });

  it("handles trailing period on number", () => {
    expect(parseNumberedSection("1.1. Authentication")).toEqual({
      text: "Authentication",
      depth: 1,
    });
  });

  it("rejects very long text (not a header)", () => {
    const longText = "1.1 " + "x".repeat(130);
    expect(parseNumberedSection(longText)).toBeNull();
  });
});

// ── extractFromText — ALL CAPS headers ──

describe("extractFromText — ALL CAPS headers", () => {
  it("detects ALL CAPS lines as section headers", () => {
    const text = `USER AUTHENTICATION
- Implement login flow
- Add OAuth2 support

API INFRASTRUCTURE
- Set up rate limiting
- Configure caching
`;
    const result = extractFromText(text);
    expect(result.proposals.length).toBeGreaterThan(0);
    expect(featureTitles(result.proposals)).toContain("User Authentication");
    expect(featureTitles(result.proposals)).toContain("Api Infrastructure");
    expect(taskTitles(result.proposals)).toContain("Implement login flow");
    expect(taskTitles(result.proposals)).toContain("Set up rate limiting");
  });

  it("treats ALL CAPS with bullets as features", () => {
    const text = `CORE FEATURES
- User registration
- Password reset
- Profile management
`;
    const result = extractFromText(text);
    expect(taskTitles(result.proposals)).toEqual([
      "User registration",
      "Password reset",
      "Profile management",
    ]);
  });
});

// ── extractFromText — underlined headers ──

describe("extractFromText — underlined headers", () => {
  it("detects === underlined headers as sections", () => {
    const text = `User Authentication
====================
- Implement login
- Add SSO

API Infrastructure
====================
- Rate limiting
- Caching
`;
    const result = extractFromText(text);
    expect(result.proposals.length).toBeGreaterThan(0);
    expect(taskTitles(result.proposals)).toContain("Implement login");
    expect(taskTitles(result.proposals)).toContain("Rate limiting");
  });

  it("detects --- underlined headers as sub-sections", () => {
    const text = `Authentication
==============
Login Flow
----------
- Validate credentials
- Handle errors

Password Reset
--------------
- Send reset email
- Validate token
`;
    const result = extractFromText(text);
    expect(result.proposals.length).toBeGreaterThan(0);
    expect(taskTitles(result.proposals)).toContain("Validate credentials");
    expect(taskTitles(result.proposals)).toContain("Send reset email");
  });

  it("maps === to depth 0 and --- to depth 1", () => {
    const text = `Main Section
============
Sub Section
-----------
- Task one
- Task two
`;
    const result = extractFromText(text);
    expect(result.proposals.length).toBeGreaterThan(0);
    // Main Section should be an epic, Sub Section a feature
    expect(epicTitles(result.proposals)).toContain("Main Section");
    expect(featureTitles(result.proposals)).toContain("Sub Section");
  });
});

// ── extractFromText — hierarchical numbered sections ──

describe("extractFromText — hierarchical numbered sections", () => {
  it("parses hierarchical numbered sections", () => {
    const text = `1.1 User Management
- Create user accounts
- Delete user accounts

1.2 Notification System
- Send email notifications
- Send push notifications
`;
    const result = extractFromText(text);
    expect(result.proposals.length).toBeGreaterThan(0);
    expect(taskTitles(result.proposals)).toContain("Create user accounts");
    expect(taskTitles(result.proposals)).toContain("Send email notifications");
  });

  it("preserves simple numbered lists as tasks (not sections)", () => {
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
});

// ── extractFromText — colon headers ──

describe("extractFromText — colon headers", () => {
  it("detects colon-delimited headers", () => {
    const text = `Authentication:
- Login flow
- Password reset

Billing:
- Payment processing
- Invoice generation
`;
    const result = extractFromText(text);
    expect(result.proposals.length).toBeGreaterThan(0);
    expect(taskTitles(result.proposals)).toContain("Login flow");
    expect(taskTitles(result.proposals)).toContain("Payment processing");
  });

  it("captures description after colon", () => {
    const text = `Authentication: core login features
- Implement OAuth
- Add SSO
`;
    const result = extractFromText(text);
    expect(result.proposals.length).toBeGreaterThan(0);
    expect(taskTitles(result.proposals)).toContain("Implement OAuth");
  });
});

// ── extractFromText — prose/NLP fallback ──

describe("extractFromText — prose requirement extraction", () => {
  it("extracts requirement sentences from unstructured prose", () => {
    const text =
      "The application is being built for enterprise customers. " +
      "The system must support multi-tenant architecture. " +
      "We had a meeting last Tuesday about the roadmap. " +
      "Users should be able to export data in CSV format. " +
      "The weather has been nice lately.";
    const result = extractFromText(text);
    const tasks = taskTitles(result.proposals);
    expect(tasks).toContain("The system must support multi-tenant architecture");
    expect(tasks).toContain("Users should be able to export data in CSV format");
    // Should NOT include non-requirement sentences
    expect(tasks).not.toContain("The weather has been nice lately");
  });

  it("handles document with only requirement prose (no bullets/headers)", () => {
    const text =
      "The platform must handle concurrent users efficiently. " +
      "It should provide real-time notifications.";
    const result = extractFromText(text);
    expect(result.proposals.length).toBeGreaterThan(0);
    expect(taskTitles(result.proposals).length).toBeGreaterThan(0);
  });

  it("returns empty for text with no requirements", () => {
    const text = "This is a general note about the project timeline and team structure.";
    const result = extractFromText(text);
    expect(result.proposals).toEqual([]);
  });
});

// ── extractFromText — deduplication ──

describe("extractFromText — deduplication", () => {
  it("deduplicates against existing items with ALL CAPS headers", () => {
    const text = `USER AUTHENTICATION
- Implement login
- Add OAuth
`;
    const result = extractFromText(text, {
      existingItems: [
        {
          id: "1",
          title: "Implement login",
          level: "task",
          status: "completed",
        } as any,
      ],
    });
    const tasks = taskTitles(result.proposals);
    expect(tasks).toContain("Add OAuth");
    expect(tasks).not.toContain("Implement login");
  });

  it("deduplicates against existing items with prose extraction", () => {
    const text = "The system must validate input. The system must handle errors.";
    const result = extractFromText(text, {
      existingItems: [
        {
          id: "1",
          title: "The system must validate input",
          level: "task",
          status: "pending",
        } as any,
      ],
    });
    const tasks = taskTitles(result.proposals);
    expect(tasks).not.toContain("The system must validate input");
    expect(tasks).toContain("The system must handle errors");
  });
});

// ── extractFromText — source tracking ──

describe("extractFromText — source tracking", () => {
  it("sets source to file-import for structured text", () => {
    const text = `USER AUTHENTICATION
- Implement login
`;
    const result = extractFromText(text);
    expect(result.proposals[0].epic.source).toBe("file-import");
    expect(result.proposals[0].features[0].source).toBe("file-import");
    expect(result.proposals[0].features[0].tasks[0].source).toBe("file-import");
  });

  it("sets source to file-import for prose extraction", () => {
    const text = "The system must validate all input fields.";
    const result = extractFromText(text);
    if (result.proposals.length > 0) {
      expect(result.proposals[0].epic.source).toBe("file-import");
    }
  });
});

// ── extractFromText — mixed formats ──

describe("extractFromText — mixed formatting styles", () => {
  it("handles document with ALL CAPS headers and mixed content", () => {
    const text = `PROJECT OVERVIEW
This project aims to build a user management system.
The platform must support role-based access control.

CORE FEATURES
- User registration
- Password management
- Profile editing

SECURITY
The system must enforce password complexity rules.
- Enable two-factor authentication
- Implement session management
`;
    const result = extractFromText(text);
    expect(result.proposals.length).toBeGreaterThan(0);
    expect(taskTitles(result.proposals)).toContain("User registration");
    expect(taskTitles(result.proposals)).toContain("Enable two-factor authentication");
  });

  it("delegates to markdown extractor when headings are present", () => {
    const text = `# Epic
## Feature
- Task
`;
    const result = extractFromText(text);
    expect(epicTitles(result.proposals)).toEqual(["Epic"]);
    expect(featureTitles(result.proposals)).toEqual(["Feature"]);
    expect(taskTitles(result.proposals)).toEqual(["Task"]);
  });

  it("handles empty content", () => {
    const result = extractFromText("");
    expect(result.proposals).toEqual([]);
    expect(result.usedLLM).toBe(false);
  });

  it("handles whitespace-only content", () => {
    const result = extractFromText("   \n\n   ");
    expect(result.proposals).toEqual([]);
  });

  it("never sets usedLLM to true", () => {
    const text = `AUTHENTICATION
- Login flow
The system must validate credentials.
`;
    const result = extractFromText(text);
    expect(result.usedLLM).toBe(false);
  });
});

// ── extractFromText — realistic documents ──

describe("extractFromText — realistic document formats", () => {
  it("handles an RFC-style requirements document", () => {
    const text = `
The system MUST authenticate users before granting access.
The system SHOULD support session timeouts of 30 minutes.
The system SHALL log all authentication attempts.
The implementation MUST NOT store passwords in plain text.
`;
    const result = extractFromText(text);
    expect(result.proposals.length).toBeGreaterThan(0);
    const tasks = taskTitles(result.proposals);
    expect(tasks.length).toBeGreaterThanOrEqual(2);
  });

  it("handles a simple requirements list with underlined headers", () => {
    const text = `
Authentication Requirements
===========================
Users must be able to log in with email and password.
The system must support password reset via email.

Performance Requirements
========================
The API must respond within 200ms for 95th percentile.
The system must handle 10,000 concurrent connections.
`;
    const result = extractFromText(text);
    expect(result.proposals.length).toBeGreaterThan(0);
    const tasks = taskTitles(result.proposals);
    expect(tasks.length).toBeGreaterThanOrEqual(2);
  });

  it("handles a document with colon sections and bullets", () => {
    const text = `
Backend:
- REST API endpoints
- Database schema design
- Authentication middleware

Frontend:
- React component library
- State management setup
- Responsive layouts
`;
    const result = extractFromText(text);
    expect(result.proposals.length).toBeGreaterThan(0);
    expect(taskTitles(result.proposals)).toContain("REST API endpoints");
    expect(taskTitles(result.proposals)).toContain("React component library");
  });
});
