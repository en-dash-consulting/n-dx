/**
 * Structured requirements extraction engine.
 *
 * Parses markdown and plain text documents into hierarchical PRD proposals
 * (epics → features → tasks) using pattern recognition. Falls back to LLM
 * assistance only when document structure is genuinely ambiguous.
 *
 * The extraction pipeline:
 * 1. Parse document structure (headings, bullets, paragraphs, code fences)
 * 2. Classify heading levels → PRD levels (epic/feature/task)
 * 3. Build hierarchical proposals from classified sections
 * 4. Deduplicate against existing PRD items
 * 5. Optionally use LLM for disambiguation of flat/unclear structures
 *
 * @module rex/analyze/extract
 */

import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { PRDItem, AnalyzeTokenUsage } from "../schema/index.js";
import type { Proposal, ProposalTask } from "./propose.js";
import {
  detectFileFormat,
  spawnClaude,
  DEFAULT_MODEL,
  extractJson,
  repairTruncatedJson,
  emptyAnalyzeTokenUsage,
  accumulateTokenUsage,
  PRD_SCHEMA,
  TASK_QUALITY_RULES,
  OUTPUT_INSTRUCTION,
} from "./reason.js";
import type { FileFormat } from "./reason.js";
import {
  validateFileInput,
  validateMarkdownContent,
  validateTextContent,
  validateJsonContent,
  validateYamlContent,
  FileValidationError,
} from "./file-validation.js";

// ── Types ──────────────────────────────────────────────────────────

export interface ExtractionOptions {
  /** Existing PRD items for deduplication. */
  existingItems?: PRDItem[];
  /** Use LLM to disambiguate unclear structures. Default: false. */
  useLLM?: boolean;
  /** LLM model to use when disambiguation is needed. */
  model?: string;
  /** Source file path to attach to extracted proposals. */
  sourceFile?: string;
  /** Preserve markdown section context as breadcrumbs in task descriptions. Default: false. */
  preserveContext?: boolean;
}

export interface ExtractionResult {
  /** Extracted proposals in standard PRD format. */
  proposals: Proposal[];
  /** Whether LLM was invoked during extraction. */
  usedLLM: boolean;
  /** Token usage if LLM was used. */
  tokenUsage?: AnalyzeTokenUsage;
  /** Non-fatal warnings about the input (e.g., markdown syntax issues). */
  warnings?: string[];
}

/** PRD level assignment for a heading depth. */
type HeadingRole = "epic" | "feature" | "task";

// ── Internal types ─────────────────────────────────────────────────

/** A parsed section from the document. */
interface Section {
  heading: string;
  headingLevel: number;
  /** Paragraph text (non-bullet, non-heading lines). */
  paragraphs: string[];
  /** Bullet/numbered list items under this heading. */
  bullets: string[];
  /** Child sections (sub-headings). */
  children: Section[];
}

// ── Heading classification ─────────────────────────────────────────

/**
 * Determine which PRD level each heading depth maps to.
 *
 * Strategy:
 * - With 3+ distinct levels: shallowest = epic, next = feature, rest = task
 * - With 2 levels: shallowest = epic, deeper = feature
 * - With 1 level: treat as feature (ambiguous without more context)
 * - Empty: no mapping
 */
export function classifyHeadingLevels(
  levels: number[],
): Record<number, HeadingRole> {
  if (levels.length === 0) return {};

  const sorted = [...new Set(levels)].sort((a, b) => a - b);
  const map: Record<number, HeadingRole> = {};

  if (sorted.length >= 3) {
    map[sorted[0]] = "epic";
    map[sorted[1]] = "feature";
    for (let i = 2; i < sorted.length; i++) {
      map[sorted[i]] = "task";
    }
  } else if (sorted.length === 2) {
    map[sorted[0]] = "epic";
    map[sorted[1]] = "feature";
  } else {
    // Single level — treat as feature
    map[sorted[0]] = "feature";
  }

  return map;
}

// ── Markdown parsing ───────────────────────────────────────────────

/** Strip inline markdown formatting from a heading string. */
function cleanHeading(raw: string): string {
  let h = raw;
  h = h.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1");
  h = h.replace(/_{1,2}([^_]+)_{1,2}/g, "$1");
  h = h.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  h = h.replace(/`([^`]+)`/g, "$1");
  h = h.replace(/~~([^~]+)~~/g, "$1");
  return h.trim();
}

/**
 * Parse markdown content into a tree of sections.
 * Handles code fences, heading hierarchy, bullets, and paragraph text.
 */
function parseMarkdownSections(content: string): {
  sections: Section[];
  headingLevels: number[];
} {
  const lines = content.split("\n");
  const headingLevels: number[] = [];

  // Root-level container for top-level sections
  const root: Section = {
    heading: "",
    headingLevel: 0,
    paragraphs: [],
    bullets: [],
    children: [],
  };

  // Stack tracks the nesting path from root to current section
  const stack: Section[] = [root];
  let inCodeBlock = false;

  for (const line of lines) {
    // Track fenced code blocks (``` or ~~~)
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // Check for heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const heading = cleanHeading(headingMatch[2]);
      headingLevels.push(level);

      const section: Section = {
        heading,
        headingLevel: level,
        paragraphs: [],
        bullets: [],
        children: [],
      };

      // Pop stack until we find a parent with a shallower heading level
      while (stack.length > 1 && stack[stack.length - 1].headingLevel >= level) {
        stack.pop();
      }

      stack[stack.length - 1].children.push(section);
      stack.push(section);
      continue;
    }

    // Check for bullet/numbered list item
    const bulletMatch = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)/);
    if (bulletMatch) {
      const current = stack[stack.length - 1];
      current.bullets.push(bulletMatch[1].trim());
      continue;
    }

    // Paragraph text (non-empty, non-heading, non-bullet)
    const trimmed = line.trim();
    if (trimmed) {
      const current = stack[stack.length - 1];
      current.paragraphs.push(trimmed);
    }
  }

  return { sections: root.children, headingLevels };
}

// ── Normalization for dedup ────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

// ── Proposal building ──────────────────────────────────────────────

const SOURCE = "file-import";

/**
 * Build a context description breadcrumb from a section path.
 * Returns a human-readable string like "Epic > Feature" or undefined.
 */
function contextDescription(contextPath?: string[]): string | undefined {
  if (!contextPath || contextPath.length === 0) return undefined;
  return `From: ${contextPath.join(" > ")}`;
}

/**
 * Build a ProposalTask from a title, optional description, and optional
 * acceptance criteria.
 */
function makeTask(
  title: string,
  description?: string,
  acceptanceCriteria?: string[],
  sourceFile?: string,
): ProposalTask {
  return {
    title,
    source: SOURCE,
    sourceFile: sourceFile ?? "",
    description,
    acceptanceCriteria:
      acceptanceCriteria && acceptanceCriteria.length > 0
        ? acceptanceCriteria
        : undefined,
  };
}

/**
 * Convert a section tree into proposals using the heading→role mapping.
 */
function buildProposalsFromSections(
  sections: Section[],
  roleMap: Record<number, HeadingRole>,
  existingTitles: Set<string>,
  sourceFile?: string,
  preserveContext?: boolean,
): Proposal[] {
  const proposals: Proposal[] = [];

  for (const section of sections) {
    const role = roleMap[section.headingLevel];

    if (role === "epic") {
      const proposal = buildEpicProposal(section, roleMap, existingTitles, sourceFile, preserveContext ? [section.heading] : undefined);
      if (proposal.features.length > 0 || !existingTitles.has(normalize(section.heading))) {
        proposals.push(proposal);
      }
    } else if (role === "feature") {
      // Feature at top level — wrap in a default epic
      const feature = buildFeature(section, roleMap, existingTitles, sourceFile, preserveContext ? ["Imported Requirements", section.heading] : undefined);
      if (feature) {
        const existing = proposals.find(
          (p) => normalize(p.epic.title) === normalize("Imported Requirements"),
        );
        if (existing) {
          existing.features.push(feature);
        } else {
          proposals.push({
            epic: { title: "Imported Requirements", source: SOURCE },
            features: [feature],
          });
        }
      }
    } else if (role === "task") {
      // Task at top level — wrap in default epic/feature
      const task = buildTaskFromSection(section, existingTitles, sourceFile);
      if (task) {
        addOrphanTask(proposals, task, existingTitles);
      }
    }
  }

  return proposals;
}

/** Build an epic-level proposal from a section and its children. */
function buildEpicProposal(
  section: Section,
  roleMap: Record<number, HeadingRole>,
  existingTitles: Set<string>,
  sourceFile?: string,
  contextPath?: string[],
): Proposal {
  const features = [];

  // Direct bullets under the epic (no feature grouping) → create a default feature
  if (section.bullets.length > 0) {
    const featureContext = contextPath ? [...contextPath, section.heading] : undefined;
    const tasks = section.bullets
      .filter((b) => !existingTitles.has(normalize(b)))
      .map((b) => makeTask(b, contextDescription(featureContext), undefined, sourceFile));
    if (tasks.length > 0) {
      features.push({
        title: section.heading,
        source: SOURCE,
        description: section.paragraphs.join(" ") || undefined,
        tasks,
      });
    }
  }

  // Child sections → features or tasks based on role mapping
  for (const child of section.children) {
    const childRole = roleMap[child.headingLevel];
    if (childRole === "feature") {
      const featureContext = contextPath ? [...contextPath, child.heading] : undefined;
      const feature = buildFeature(child, roleMap, existingTitles, sourceFile, featureContext);
      if (feature) features.push(feature);
    } else if (childRole === "task") {
      // Task directly under epic — group into a feature named after the epic
      const task = buildTaskFromSection(child, existingTitles, sourceFile, contextPath ? [...contextPath, section.heading] : undefined);
      if (task) {
        // Find or create a "General" feature under this epic
        let generalFeature: { title: string; source: string; description?: string; tasks: ProposalTask[] } | undefined =
          features.find((f) => normalize(f.title) === normalize(section.heading));
        if (!generalFeature) {
          generalFeature = {
            title: section.heading,
            source: SOURCE,
            description: section.paragraphs.join(" ") || undefined,
            tasks: [],
          };
          features.push(generalFeature);
        }
        generalFeature.tasks.push(task);
      }
    }
  }

  // If no features were created but there are paragraphs, create a placeholder
  if (features.length === 0 && section.paragraphs.length > 0) {
    features.push({
      title: section.heading,
      source: SOURCE,
      description: section.paragraphs.join(" "),
      tasks: [],
    });
  }

  return {
    epic: { title: section.heading, source: SOURCE },
    features,
  };
}

/** Build a feature from a section. Returns null if all content is duplicate. */
function buildFeature(
  section: Section,
  roleMap: Record<number, HeadingRole>,
  existingTitles: Set<string>,
  sourceFile?: string,
  contextPath?: string[],
): { title: string; source: string; description?: string; tasks: ProposalTask[] } | null {
  if (existingTitles.has(normalize(section.heading))) return null;

  const tasks: ProposalTask[] = [];

  // Bullets under this feature → tasks
  for (const bullet of section.bullets) {
    if (!existingTitles.has(normalize(bullet))) {
      tasks.push(makeTask(bullet, contextDescription(contextPath), undefined, sourceFile));
    }
  }

  // Child sections that are task-level
  for (const child of section.children) {
    const childRole = roleMap[child.headingLevel];
    if (childRole === "task" || !childRole) {
      const task = buildTaskFromSection(child, existingTitles, sourceFile, contextPath);
      if (task) tasks.push(task);
    }
  }

  const description = section.paragraphs.join(" ") || undefined;

  return {
    title: section.heading,
    source: SOURCE,
    description,
    tasks,
  };
}

/** Build a task from a section (heading with optional description/bullets). */
function buildTaskFromSection(
  section: Section,
  existingTitles: Set<string>,
  sourceFile?: string,
  contextPath?: string[],
): ProposalTask | null {
  if (existingTitles.has(normalize(section.heading))) return null;

  const paragraphDesc = section.paragraphs.join(" ") || undefined;
  const contextDesc = contextDescription(contextPath);
  // Merge paragraph description with context breadcrumb
  const description = paragraphDesc && contextDesc
    ? `${paragraphDesc} [${contextDesc}]`
    : paragraphDesc ?? contextDesc;

  return makeTask(
    section.heading,
    description,
    section.bullets.length > 0 ? section.bullets : undefined,
    sourceFile,
  );
}

/** Add an orphan task (no parent feature) into the proposals. */
function addOrphanTask(
  proposals: Proposal[],
  task: ProposalTask,
  _existingTitles: Set<string>,
): void {
  const defaultEpicTitle = "Imported Requirements";
  const defaultFeatureTitle = "General";

  let epicProposal = proposals.find(
    (p) => normalize(p.epic.title) === normalize(defaultEpicTitle),
  );
  if (!epicProposal) {
    epicProposal = {
      epic: { title: defaultEpicTitle, source: SOURCE },
      features: [],
    };
    proposals.push(epicProposal);
  }

  let feature = epicProposal.features.find(
    (f) => normalize(f.title) === normalize(defaultFeatureTitle),
  );
  if (!feature) {
    feature = { title: defaultFeatureTitle, source: SOURCE, tasks: [] };
    epicProposal.features.push(feature);
  }

  feature.tasks.push(task);
}

// ── Plain text parsing ─────────────────────────────────────────────

/** Check if content looks like markdown (contains headings). */
function looksLikeMarkdown(content: string): boolean {
  return /^#{1,6}\s+/m.test(content);
}

/**
 * Parse plain text into sections separated by blank lines.
 * Each section has a potential title (first non-bullet line) and bullets.
 */
function parsePlainTextBlocks(
  content: string,
): { title: string | null; bullets: string[] }[] {
  const lines = content.split("\n");
  const blocks: { title: string | null; bullets: string[] }[] = [];
  let currentTitle: string | null = null;
  let currentBullets: string[] = [];
  let hasContent = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Blank line → end of block
    if (!trimmed) {
      if (hasContent) {
        blocks.push({ title: currentTitle, bullets: [...currentBullets] });
        currentTitle = null;
        currentBullets = [];
        hasContent = false;
      }
      continue;
    }

    // Bullet or numbered item
    const bulletMatch = trimmed.match(/^(?:[-*]|\d+\.)\s+(.+)/);
    if (bulletMatch) {
      currentBullets.push(bulletMatch[1].trim());
      hasContent = true;
      continue;
    }

    // Non-bullet text line — potential title for this block
    if (currentTitle === null && currentBullets.length === 0) {
      currentTitle = trimmed;
    }
    hasContent = true;
  }

  // Flush remaining
  if (hasContent) {
    blocks.push({ title: currentTitle, bullets: [...currentBullets] });
  }

  return blocks;
}

// ── Enhanced text parsing (NLP-like) ──────────────────────────────

/** A parsed text section with a detected header and body content. */
interface TextSection {
  /** Section header text. */
  header: string;
  /** Nesting depth (0 = top-level, 1 = sub-section, etc.). */
  depth: number;
  /** Paragraph lines under this section. */
  paragraphs: string[];
  /** Bullet/numbered items under this section. */
  bullets: string[];
  /** Child sections. */
  children: TextSection[];
}

/**
 * Detect whether a line is an ALL CAPS header.
 * Requires at least 2 word characters and no lowercase letters.
 * Excludes lines that look like abbreviations (e.g., "API", "UI") unless
 * they have spaces (multi-word).
 */
export function isAllCapsHeader(line: string): boolean {
  const trimmed = line.trim();
  // Must have at least 2 words or be a reasonably long single word (6+ chars)
  if (!/[A-Z]/.test(trimmed) || /[a-z]/.test(trimmed)) return false;
  // Must contain at least 2 word characters
  const wordChars = trimmed.replace(/[^A-Z0-9]/g, "");
  if (wordChars.length < 3) return false;
  // Multi-word OR long single word
  const words = trimmed.split(/\s+/).filter((w) => /[A-Z]/.test(w));
  return words.length >= 2 || trimmed.length >= 6;
}

/**
 * Detect whether the next line is an underline (=== or ---),
 * making the current line a header.
 */
function isUnderlineHeader(line: string, nextLine: string | undefined): boolean {
  if (!nextLine) return false;
  const trimmedNext = nextLine.trim();
  // Must be at least 3 characters of = or -
  return /^[=]{3,}$/.test(trimmedNext) || /^[-]{3,}$/.test(trimmedNext);
}

/** Get underline header depth: === is depth 0, --- is depth 1. */
function underlineDepth(underline: string): number {
  return underline.trim().startsWith("=") ? 0 : 1;
}

/**
 * Detect hierarchical numbered section headers like "1.1 Section",
 * "1.2.3 Implementation details".
 *
 * Only matches hierarchical numbering (contains dots between digits)
 * to avoid conflating simple numbered lists (1., 2., 3.) with section
 * headers. Simple "N. text" is handled by the bullet parser instead.
 */
export function parseNumberedSection(
  line: string,
): { text: string; depth: number } | null {
  const trimmed = line.trim();

  // Pattern: "1.1 Title" or "1.1. Title" or "2.3.1 Title" (hierarchical numbering)
  // Requires at least one dot between digits to distinguish from plain numbered lists
  const hierarchicalNum = trimmed.match(
    /^(\d+\.\d+(?:\.\d+)*)\.?\s+(.+)/,
  );
  if (hierarchicalNum) {
    const parts = hierarchicalNum[1].split(".");
    const text = hierarchicalNum[2].trim();
    // Only treat as section if the text part isn't too long (looks like a header)
    if (text.length <= 120) {
      return { text, depth: parts.length - 1 };
    }
  }

  return null;
}

/**
 * Requirement keywords that indicate a requirement sentence.
 * Matches RFC 2119-style keywords and common requirement phrasing.
 */
const REQUIREMENT_PATTERNS = [
  // RFC 2119 keywords (case-insensitive via flag)
  /\b(?:must|shall|should|will|need to|required to)\b/i,
  // Common requirement phrasing
  /\b(?:the system|the application|the platform|the service|users?)\s+(?:must|shall|should|will|can|need)\b/i,
  // Action-oriented phrases
  /\b(?:implement|support|provide|enable|allow|ensure|handle|validate|display|create|add|integrate)\b/i,
];

/**
 * Detect whether a sentence expresses a requirement.
 * Returns true if the sentence contains requirement keywords.
 */
export function isRequirementSentence(sentence: string): boolean {
  return REQUIREMENT_PATTERNS.some((pattern) => pattern.test(sentence));
}

/**
 * Split prose text into individual sentences.
 * Handles common abbreviations to avoid false splits.
 */
function splitSentences(text: string): string[] {
  // Replace common abbreviations to prevent false splits
  let processed = text;
  const abbreviations = ["e.g.", "i.e.", "etc.", "vs.", "Dr.", "Mr.", "Mrs.", "Ms.", "Jr.", "Sr."];
  const placeholders: Map<string, string> = new Map();
  for (const abbr of abbreviations) {
    const placeholder = `__ABBR${placeholders.size}__`;
    placeholders.set(placeholder, abbr);
    processed = processed.replaceAll(abbr, placeholder);
  }

  // Split on sentence terminators followed by space + capital or end of string
  const parts = processed.split(/(?<=[.!?])\s+(?=[A-Z])|(?<=[.!?])$/);

  // Restore abbreviations and clean up
  return parts
    .map((s) => {
      let restored = s;
      for (const [placeholder, abbr] of placeholders) {
        restored = restored.replaceAll(placeholder, abbr);
      }
      return restored.trim();
    })
    .filter((s) => s.length > 0);
}

/**
 * Extract requirement sentences from prose text.
 * Returns an array of cleaned requirement strings suitable for task titles.
 */
export function extractRequirementSentences(text: string): string[] {
  const sentences = splitSentences(text);
  return sentences
    .filter((s) => isRequirementSentence(s))
    .map((s) => {
      // Trim trailing period/semicolon for cleaner task titles
      let cleaned = s.replace(/[.;]+$/, "").trim();
      // Cap length — very long sentences are descriptions, not tasks
      if (cleaned.length > 150) return "";
      return cleaned;
    })
    .filter((s) => s.length > 0);
}

/**
 * Check if a line looks like a colon-delimited header.
 * Examples: "Authentication:", "User Management: core features"
 * The colon must be at the end or followed by descriptive text.
 */
function isColonHeader(line: string): { header: string; description: string | null } | null {
  const trimmed = line.trim();
  // Must have a colon and the part before colon should be short (header-like)
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx === -1 || colonIdx > 60) return null;

  const before = trimmed.slice(0, colonIdx).trim();
  const after = trimmed.slice(colonIdx + 1).trim();

  // Header part should be 1-8 words and not look like a sentence
  const words = before.split(/\s+/);
  if (words.length < 1 || words.length > 8) return null;
  // Should not contain sentence-ending punctuation
  if (/[.!?]/.test(before)) return null;
  // Should start with a capital letter or be ALL CAPS
  if (!/^[A-Z]/.test(before)) return null;

  return {
    header: before,
    description: after.length > 0 ? after : null,
  };
}

/**
 * Detect whether a line is a separator (e.g., "---", "===", "***", "___").
 * A separator acts as a section break between blocks of content.
 * Requires at least 3 repeated characters and nothing else on the line.
 */
function isSeparatorLine(line: string): boolean {
  return /^[-=*_]{3,}$/.test(line.trim());
}

/**
 * Extract priority or tag annotations from text.
 *
 * Detects common conventions:
 * - Bracketed tags: `[HIGH]`, `[P1]`, `[MUST]`, `[CRITICAL]`
 * - Parenthetical tags: `(HIGH)`, `(P1)`, `(MUST-HAVE)`
 * - Prefix labels: `TODO:`, `REQ:`, `REQUIREMENT:`, `ACTION:`
 *
 * Returns the cleaned text (tag removed) and the detected priority, or
 * null if no tag was found.
 */
export function extractPriorityTag(text: string): {
  cleaned: string;
  priority: "critical" | "high" | "medium" | "low" | null;
  tag: string | null;
} {
  let cleaned = text;
  let priority: "critical" | "high" | "medium" | "low" | null = null;
  let tag: string | null = null;

  // Map keywords to priorities
  const PRIORITY_MAP: Record<string, "critical" | "high" | "medium" | "low"> = {
    critical: "critical",
    "p0": "critical",
    "p1": "high",
    high: "high",
    "must": "high",
    "must-have": "high",
    "required": "high",
    "p2": "medium",
    medium: "medium",
    "should": "medium",
    "nice-to-have": "low",
    "p3": "low",
    low: "low",
    "could": "low",
    "optional": "low",
  };

  // Check for bracketed tags: [HIGH], [P1], [MUST]
  const bracketMatch = cleaned.match(/\[([A-Za-z0-9-]+)\]/);
  if (bracketMatch) {
    const tagValue = bracketMatch[1].toLowerCase();
    if (PRIORITY_MAP[tagValue]) {
      priority = PRIORITY_MAP[tagValue];
      tag = bracketMatch[1];
      cleaned = cleaned.replace(bracketMatch[0], "").trim();
    }
  }

  // Check for parenthetical tags: (HIGH), (P1), (MUST-HAVE)
  if (!priority) {
    const parenMatch = cleaned.match(/\(([A-Za-z0-9-]+)\)$/);
    if (parenMatch) {
      const tagValue = parenMatch[1].toLowerCase();
      if (PRIORITY_MAP[tagValue]) {
        priority = PRIORITY_MAP[tagValue];
        tag = parenMatch[1];
        cleaned = cleaned.replace(parenMatch[0], "").trim();
      }
    }
  }

  // Check for prefix labels: TODO:, REQ:, REQUIREMENT:, ACTION:
  const prefixMatch = cleaned.match(
    /^(?:TODO|REQ|REQUIREMENT|ACTION|FIXME|HACK|NOTE):\s*/i,
  );
  if (prefixMatch) {
    if (!tag) tag = prefixMatch[0].replace(/:\s*$/, "").trim();
    cleaned = cleaned.slice(prefixMatch[0].length).trim();
    // Prefix labels default to high priority if no other priority was set
    if (!priority) {
      const label = prefixMatch[0].toLowerCase().trim();
      if (label.startsWith("fixme") || label.startsWith("req") || label.startsWith("requirement")) {
        priority = "high";
      } else if (label.startsWith("todo") || label.startsWith("action")) {
        priority = "medium";
      }
    }
  }

  return { cleaned, priority, tag };
}

/**
 * Measure the indentation depth of a line in spaces.
 * Tabs are counted as 4 spaces.
 */
function measureIndent(line: string): number {
  let indent = 0;
  for (const ch of line) {
    if (ch === " ") indent++;
    else if (ch === "\t") indent += 4;
    else break;
  }
  return indent;
}

/**
 * Parse plain text into hierarchical sections using multiple heuristics:
 * - ALL CAPS lines as top-level headers
 * - Underlined text (=== / ---) as headers
 * - Numbered sections (1., 1.1, etc.)
 * - Colon-delimited headers
 * - Separator lines (---, ===, ***) as section breaks
 * - Indentation-based hierarchy (tabs/spaces for nesting)
 * - Blank-line-separated blocks as implicit sections
 *
 * Returns detected sections plus a flag indicating whether any structured
 * headers were found (vs. purely unstructured prose).
 */
function parseTextSections(content: string): {
  sections: TextSection[];
  hasStructuredHeaders: boolean;
} {
  const lines = content.split("\n");
  const sections: TextSection[] = [];
  let hasStructuredHeaders = false;

  let currentSection: TextSection | null = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip blank lines (they separate blocks)
    if (!trimmed) {
      i++;
      continue;
    }

    // Check for separator lines (---, ===, ***) that act as section breaks
    // but are NOT underlines for the previous line (standalone separators)
    if (isSeparatorLine(trimmed) && (i === 0 || lines[i - 1].trim() === "")) {
      // Standalone separator — end current section
      currentSection = null;
      i++;
      continue;
    }

    // Check for underlined header (text + === or ---)
    if (isUnderlineHeader(trimmed, lines[i + 1])) {
      hasStructuredHeaders = true;
      const depth = underlineDepth(lines[i + 1].trim());
      currentSection = {
        header: trimmed,
        depth,
        paragraphs: [],
        bullets: [],
        children: [],
      };
      sections.push(currentSection);
      i += 2; // Skip header + underline
      continue;
    }

    // Check for ALL CAPS header
    if (isAllCapsHeader(trimmed)) {
      hasStructuredHeaders = true;
      currentSection = {
        header: titleCase(trimmed),
        depth: 0,
        paragraphs: [],
        bullets: [],
        children: [],
      };
      sections.push(currentSection);
      i++;
      continue;
    }

    // Check for numbered section
    const numbered = parseNumberedSection(trimmed);
    if (numbered) {
      hasStructuredHeaders = true;
      currentSection = {
        header: numbered.text,
        depth: numbered.depth,
        paragraphs: [],
        bullets: [],
        children: [],
      };
      sections.push(currentSection);
      i++;
      continue;
    }

    // Check for colon header (only when no section is active or at block boundary)
    if (!currentSection || (i > 0 && lines[i - 1].trim() === "")) {
      const colonHeader = isColonHeader(trimmed);
      if (colonHeader) {
        hasStructuredHeaders = true;
        currentSection = {
          header: colonHeader.header,
          depth: 0,
          paragraphs: colonHeader.description ? [colonHeader.description] : [],
          bullets: [],
          children: [],
        };
        sections.push(currentSection);
        i++;
        continue;
      }
    }

    // Check for bullet/numbered list item (with indentation-aware nesting)
    const bulletMatch = trimmed.match(/^(?:[-*]|\d+\.)\s+(.+)/);
    if (bulletMatch) {
      const bulletText = bulletMatch[1].trim();
      if (currentSection) {
        currentSection.bullets.push(bulletText);
      } else {
        // Orphan bullet — create an implicit section
        currentSection = {
          header: "",
          depth: 0,
          paragraphs: [],
          bullets: [bulletText],
          children: [],
        };
        sections.push(currentSection);
      }
      i++;
      continue;
    }

    // Paragraph text
    if (currentSection) {
      currentSection.paragraphs.push(trimmed);
    } else {
      // Orphan text — create an implicit section
      currentSection = {
        header: "",
        depth: 0,
        paragraphs: [trimmed],
        bullets: [],
        children: [],
      };
      sections.push(currentSection);
    }
    i++;
  }

  return { sections, hasStructuredHeaders };
}

/**
 * Parse text where hierarchy is defined by indentation levels rather than
 * explicit headers. Each indentation level maps to a PRD depth.
 *
 * Example:
 *   User Management          → epic (indent 0)
 *     Registration            → feature (indent 4)
 *       Email validation      → task (indent 8)
 *       Password rules        → task (indent 8)
 *     Login                   → feature (indent 4)
 *       OAuth support         → task (indent 8)
 */
function parseIndentedText(content: string): {
  sections: TextSection[];
  hasIndentedStructure: boolean;
} {
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { sections: [], hasIndentedStructure: false };

  // Measure indentation of all non-empty, non-bullet lines
  const indents: number[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip bullets and lines that are just punctuation
    if (/^(?:[-*]|\d+\.)\s+/.test(trimmed)) continue;
    const indent = measureIndent(line);
    indents.push(indent);
  }

  // Check if we have a meaningful indentation hierarchy
  const uniqueIndents = [...new Set(indents)].sort((a, b) => a - b);
  if (uniqueIndents.length < 2) {
    return { sections: [], hasIndentedStructure: false };
  }

  // Need at least a couple of lines at the shallowest indent to be useful
  const minIndent = uniqueIndents[0];
  const topLevelCount = indents.filter((i) => i === minIndent).length;
  if (topLevelCount < 1) {
    return { sections: [], hasIndentedStructure: false };
  }

  // Map indent levels to depths
  const indentToDepth: Record<number, number> = {};
  for (let d = 0; d < uniqueIndents.length; d++) {
    indentToDepth[uniqueIndents[d]] = d;
  }

  // Build sections from indented lines
  const sections: TextSection[] = [];
  let currentSection: TextSection | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const indent = measureIndent(line);

    // Check for bullet under current section
    const bulletMatch = trimmed.match(/^(?:[-*]|\d+\.)\s+(.+)/);
    if (bulletMatch && currentSection) {
      currentSection.bullets.push(bulletMatch[1].trim());
      continue;
    }

    // Non-bullet line — treat as a header at this indent level
    const depth = indentToDepth[indent] ?? 0;
    currentSection = {
      header: trimmed,
      depth,
      paragraphs: [],
      bullets: [],
      children: [],
    };
    sections.push(currentSection);
  }

  return { sections, hasIndentedStructure: sections.length >= 2 };
}

/** Convert ALL CAPS text to Title Case. */
function titleCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/(?:^|\s)\w/g, (c) => c.toUpperCase());
}

/**
 * Build proposals from structured text sections (ALL CAPS, underlined,
 * numbered, or colon-delimited headers).
 */
function buildFromStructuredText(
  sections: TextSection[],
  existingTitles: Set<string>,
  sourceFile?: string,
): Proposal[] {
  const proposals: Proposal[] = [];

  // Determine depth mapping: shallowest depth → epic, next → feature, rest → task
  const depths = [...new Set(
    sections.filter((s) => s.header).map((s) => s.depth),
  )].sort((a, b) => a - b);
  const depthRole: Record<number, HeadingRole> = {};
  if (depths.length >= 3) {
    depthRole[depths[0]] = "epic";
    depthRole[depths[1]] = "feature";
    for (let i = 2; i < depths.length; i++) depthRole[depths[i]] = "task";
  } else if (depths.length === 2) {
    depthRole[depths[0]] = "epic";
    depthRole[depths[1]] = "feature";
  } else if (depths.length === 1) {
    depthRole[depths[0]] = "feature";
  }

  // Track the most recent epic proposal so features are associated correctly
  let currentEpic: Proposal | null = null;

  for (const section of sections) {
    if (!section.header) continue;
    const role = depthRole[section.depth];

    if (role === "epic") {
      const features: { title: string; source: string; description?: string; tasks: ProposalTask[] }[] = [];

      // Direct bullets → tasks under a default feature
      const bulletTasks = section.bullets
        .filter((b) => !existingTitles.has(normalize(b)))
        .map((b) => makeTask(b, undefined, undefined, sourceFile));

      // Extract requirement sentences from paragraphs
      const proseText = section.paragraphs.join(" ");
      const reqSentences = extractRequirementSentences(proseText);
      const reqTasks = reqSentences
        .filter((s) => !existingTitles.has(normalize(s)))
        .map((s) => makeTask(s, undefined, undefined, sourceFile));

      const allTasks = [...bulletTasks, ...reqTasks];
      if (allTasks.length > 0) {
        features.push({
          title: section.header,
          source: SOURCE,
          description: proseText || undefined,
          tasks: allTasks,
        });
      }

      if (features.length > 0 || !existingTitles.has(normalize(section.header))) {
        const proposal: Proposal = {
          epic: { title: section.header, source: SOURCE },
          features,
        };
        proposals.push(proposal);
        currentEpic = proposal;
      }
    } else if (role === "feature") {
      const tasks = section.bullets
        .filter((b) => !existingTitles.has(normalize(b)))
        .map((b) => makeTask(b, undefined, undefined, sourceFile));

      // Extract requirement sentences from paragraphs
      const proseText = section.paragraphs.join(" ");
      const reqSentences = extractRequirementSentences(proseText);
      const reqTasks = reqSentences
        .filter((s) => !existingTitles.has(normalize(s)))
        .map((s) => makeTask(s, undefined, undefined, sourceFile));

      const allTasks = [...tasks, ...reqTasks];
      if (existingTitles.has(normalize(section.header)) && allTasks.length === 0) continue;

      const feature = {
        title: section.header,
        source: SOURCE,
        description: proseText || undefined,
        tasks: allTasks,
      };

      // Attach to the most recent epic, or create a default one
      if (currentEpic) {
        currentEpic.features.push(feature);
      } else {
        let defaultEpic = proposals.find(
          (p) => normalize(p.epic.title) === normalize("Imported Requirements"),
        );
        if (!defaultEpic) {
          defaultEpic = {
            epic: { title: "Imported Requirements", source: SOURCE },
            features: [],
          };
          proposals.push(defaultEpic);
        }
        defaultEpic.features.push(feature);
      }
    } else {
      // Task-level or no role
      if (existingTitles.has(normalize(section.header))) continue;
      const task = makeTask(
        section.header,
        section.paragraphs.join(" ") || undefined,
        section.bullets.length > 0 ? section.bullets : undefined,
        sourceFile,
      );
      addOrphanTask(proposals, task, existingTitles);
    }
  }

  return proposals.filter((p) => p.features.length > 0);
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Extract structured requirements from markdown content.
 *
 * Uses heading hierarchy to determine epic/feature/task mapping:
 * - Shallowest heading → epic
 * - Next level → feature
 * - Deeper levels → task
 *
 * Bullet points under features become tasks. Bullet points under task
 * headings become acceptance criteria. Paragraph text becomes descriptions.
 */
export function extractFromMarkdown(
  content: string,
  options?: ExtractionOptions,
): ExtractionResult {
  if (!content.trim()) {
    return { proposals: [], usedLLM: false };
  }

  const existingTitles = new Set(
    (options?.existingItems ?? []).map((item) => normalize(item.title)),
  );

  const { sections, headingLevels } = parseMarkdownSections(content);

  // No headings at all — just bullets or prose
  if (headingLevels.length === 0) {
    return buildFromFlatContent(content, existingTitles, options?.sourceFile);
  }

  const roleMap = classifyHeadingLevels(headingLevels);
  const proposals = buildProposalsFromSections(
    sections,
    roleMap,
    existingTitles,
    options?.sourceFile,
    options?.preserveContext,
  );

  // Filter out empty proposals
  const filtered = proposals.filter(
    (p) => p.features.length > 0,
  );

  return { proposals: filtered, usedLLM: false };
}

/**
 * Extract structured requirements from plain text content.
 *
 * Uses a multi-strategy approach:
 * 1. If the text contains markdown headings, delegates to `extractFromMarkdown`.
 * 2. Detects text conventions: ALL CAPS headers, underlined headers (=== / ---),
 *    numbered sections (1., 1.1), colon-delimited headers, and separator lines.
 * 3. Tries indentation-based hierarchy detection (tabs/spaces for nesting).
 * 4. Falls back to blank-line-separated blocks with bullet extraction.
 * 5. For unstructured prose, uses NLP-like heuristics to extract requirement
 *    sentences (must, should, shall, etc.).
 *
 * Priority and tag annotations (`[HIGH]`, `(P1)`, `TODO:`) are extracted
 * from task titles and attached as metadata when detected.
 */
export function extractFromText(
  content: string,
  options?: ExtractionOptions,
): ExtractionResult {
  if (!content.trim()) {
    return { proposals: [], usedLLM: false };
  }

  // If content looks like markdown, use the markdown extractor
  if (looksLikeMarkdown(content)) {
    return extractFromMarkdown(content, options);
  }

  const existingTitles = new Set(
    (options?.existingItems ?? []).map((item) => normalize(item.title)),
  );
  const sourceFile = options?.sourceFile;

  // Try structured text parsing (ALL CAPS, underlined, numbered, separator headers)
  const { sections, hasStructuredHeaders } = parseTextSections(content);
  if (hasStructuredHeaders) {
    const proposals = buildFromStructuredText(sections, existingTitles, sourceFile);
    if (proposals.length > 0) {
      return { proposals: applyPriorityExtraction(proposals), usedLLM: false };
    }
  }

  // Try indentation-based hierarchy (tabs/spaces)
  const { sections: indentSections, hasIndentedStructure } = parseIndentedText(content);
  if (hasIndentedStructure) {
    const proposals = buildFromStructuredText(indentSections, existingTitles, sourceFile);
    if (proposals.length > 0) {
      return { proposals: applyPriorityExtraction(proposals), usedLLM: false };
    }
  }

  // Fall back to block-based parsing (blank-line-separated)
  const blockResult = buildFromFlatContent(content, existingTitles, sourceFile);
  if (blockResult.proposals.length > 0) {
    return { ...blockResult, proposals: applyPriorityExtraction(blockResult.proposals) };
  }

  // Final fallback: extract requirement sentences from prose
  const proseResult = buildFromProse(content, existingTitles, sourceFile);
  return { ...proseResult, proposals: applyPriorityExtraction(proseResult.proposals) };
}

/**
 * Apply priority/tag extraction to task titles across all proposals.
 * Modifies task titles to remove inline priority annotations and sets
 * the priority field when detected.
 */
function applyPriorityExtraction(proposals: Proposal[]): Proposal[] {
  return proposals.map((p) => ({
    ...p,
    features: p.features.map((f) => ({
      ...f,
      tasks: f.tasks.map((t) => {
        const { cleaned, priority } = extractPriorityTag(t.title);
        if (priority && cleaned !== t.title) {
          return { ...t, title: cleaned, priority };
        }
        return t;
      }),
    })),
  }));
}

/**
 * Extract structured requirements from a file. Validates the file
 * input, auto-detects format, and delegates to the appropriate extractor.
 *
 * @throws {FileValidationError} when the file is missing, unsupported,
 *   too large, binary, empty, has mismatched content type, or cannot be
 *   read as UTF-8.
 */
export async function extractFromFile(
  filePath: string,
  options?: ExtractionOptions,
): Promise<ExtractionResult> {
  // Validate file before reading — checks existence, extension, size,
  // binary content, magic bytes, and emptiness.
  const validation = await validateFileInput(filePath);

  // Read file with encoding error handling
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch (err: unknown) {
    throw new FileValidationError(
      `Cannot read file as UTF-8: ${(err as Error).message}`,
      "ENCODING_ERROR",
      "Ensure the file uses UTF-8 encoding. Re-save the file with a text editor that supports UTF-8.",
    );
  }

  // Auto-populate sourceFile from the file path when not explicitly provided
  const effectiveOptions: ExtractionOptions = {
    ...options,
    sourceFile: options?.sourceFile ?? filePath,
  };

  // Collect warnings from file-level validation (e.g., large file)
  const allWarnings: string[] = [...(validation.warnings ?? [])];

  // Run content-level validation for supported formats
  if (validation.format === "markdown") {
    const mdValidation = validateMarkdownContent(content);
    allWarnings.push(...mdValidation.warnings);
  } else if (validation.format === "text") {
    const txtValidation = validateTextContent(content);
    allWarnings.push(...txtValidation.warnings);
  } else if (validation.format === "json") {
    const jsonValidation = validateJsonContent(content);
    allWarnings.push(...jsonValidation.warnings);
    if (!jsonValidation.valid) {
      throw new FileValidationError(
        `Invalid JSON in "${filePath}": ${jsonValidation.warnings[0]}`,
        "PARSE_ERROR",
        "Fix the JSON syntax errors and try again. Use a JSON validator to identify the issue.",
      );
    }
  } else if (validation.format === "yaml") {
    const yamlValidation = validateYamlContent(content);
    allWarnings.push(...yamlValidation.warnings);
  }

  // Extraction with error wrapping
  let result: ExtractionResult;
  try {
    if (validation.format === "markdown") {
      result = extractFromMarkdown(content, effectiveOptions);
    } else if (validation.format === "text") {
      result = extractFromText(content, effectiveOptions);
    } else {
      // For JSON/YAML and unknown formats, try text extractor as fallback
      result = extractFromText(content, effectiveOptions);
    }
  } catch (err: unknown) {
    // Re-throw FileValidationErrors as-is
    if (err instanceof FileValidationError) throw err;
    // Wrap unexpected errors in a structured error
    throw new FileValidationError(
      `Failed to parse "${filePath}": ${(err as Error).message}`,
      "PARSE_ERROR",
      "The file content could not be processed. Check for encoding issues or corrupted content.",
    );
  }

  // Attach any warnings from validation
  if (allWarnings.length > 0) {
    result = { ...result, warnings: allWarnings };
  }

  return result;
}

// ── Flat content handler ───────────────────────────────────────────

/**
 * Build proposals from content that has no heading structure.
 * Used for plain text and headingless markdown.
 */
function buildFromFlatContent(
  content: string,
  existingTitles: Set<string>,
  sourceFile?: string,
): ExtractionResult {
  const blocks = parsePlainTextBlocks(content);

  // If there are no bullets at all, we can't extract structured items
  const hasBullets = blocks.some((b) => b.bullets.length > 0);
  if (!hasBullets) {
    return { proposals: [], usedLLM: false };
  }

  const features: {
    title: string;
    source: string;
    description?: string;
    tasks: ProposalTask[];
  }[] = [];

  for (const block of blocks) {
    if (block.bullets.length === 0) continue;

    const tasks = block.bullets
      .filter((b) => !existingTitles.has(normalize(b)))
      .map((b) => makeTask(b, undefined, undefined, sourceFile));

    if (tasks.length === 0) continue;

    const featureTitle = block.title ?? "General";
    const existing = features.find(
      (f) => normalize(f.title) === normalize(featureTitle),
    );
    if (existing) {
      existing.tasks.push(...tasks);
    } else {
      features.push({
        title: featureTitle,
        source: SOURCE,
        tasks,
      });
    }
  }

  if (features.length === 0) {
    return { proposals: [], usedLLM: false };
  }

  return {
    proposals: [
      {
        epic: { title: "Imported Requirements", source: SOURCE },
        features,
      },
    ],
    usedLLM: false,
  };
}

// ── Prose content handler ─────────────────────────────────────────

/**
 * Build proposals from unstructured prose text by extracting sentences
 * that contain requirement keywords (must, should, shall, will, etc.).
 *
 * This is the final fallback when no structured headers or bullets are
 * detected. Uses NLP-like heuristics to identify actionable requirements.
 */
function buildFromProse(
  content: string,
  existingTitles: Set<string>,
  sourceFile?: string,
): ExtractionResult {
  const requirements = extractRequirementSentences(content);
  const tasks = requirements
    .filter((r) => !existingTitles.has(normalize(r)))
    .map((r) => makeTask(r, undefined, undefined, sourceFile));

  if (tasks.length === 0) {
    return { proposals: [], usedLLM: false };
  }

  return {
    proposals: [
      {
        epic: { title: "Imported Requirements", source: SOURCE },
        features: [
          {
            title: "General",
            source: SOURCE,
            tasks,
          },
        ],
      },
    ],
    usedLLM: false,
  };
}

// ── LLM disambiguation ───────────────────────────────────────────

/**
 * Zod schema for LLM disambiguation response.
 * The LLM returns a structured JSON array of proposals matching the
 * standard Proposal shape used across the rex analyze pipeline.
 */
const DisambiguationTaskSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
});

const DisambiguationFeatureSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  tasks: z.array(DisambiguationTaskSchema),
});

const DisambiguationProposalSchema = z.object({
  epic: z.object({ title: z.string() }),
  features: z.array(DisambiguationFeatureSchema),
});

const DisambiguationResponseSchema = z.array(DisambiguationProposalSchema);

/**
 * Determine whether the pattern-recognition result is ambiguous enough
 * to benefit from LLM assistance.
 *
 * Ambiguous signals:
 * - Empty proposals from a non-trivial document (content exists but couldn't be structured)
 * - All items landed in the default "Imported Requirements" / "General" bucket
 * - Single heading level (unclear epic vs feature distinction)
 * - Prose-only content with extracted requirement sentences that could be better grouped
 */
export function isAmbiguousStructure(
  proposals: Proposal[],
  content: string,
): boolean {
  const trimmed = content.trim();
  // Don't consider very short content ambiguous — not enough to justify an LLM call
  if (trimmed.length < 100) return false;

  // No proposals from non-trivial content → the heuristics couldn't parse it
  if (proposals.length === 0) return true;

  // Everything fell into the default "Imported Requirements" bucket → unclear structure
  const allDefault = proposals.every(
    (p) => normalize(p.epic.title) === normalize("Imported Requirements"),
  );
  if (allDefault) return true;

  // Single epic with a single feature and many tasks → might benefit from LLM grouping
  if (
    proposals.length === 1 &&
    proposals[0].features.length === 1 &&
    proposals[0].features[0].tasks.length > 5
  ) {
    return true;
  }

  return false;
}

/**
 * Build the LLM prompt for disambiguating an unclear document structure.
 * The prompt includes the raw content and asks the LLM to classify it
 * into the standard epic → feature → task hierarchy.
 */
function buildDisambiguationPrompt(
  content: string,
  existingTitles: Set<string>,
): string {
  const existingList = existingTitles.size > 0
    ? `\nExisting items to avoid duplicating:\n${[...existingTitles].map((t) => `- ${t}`).join("\n")}\n`
    : "";

  return `You are a product requirements analyst. The following document contains requirements but its structure is ambiguous. Analyze the content and organize it into a hierarchical PRD structure.

${PRD_SCHEMA}

${TASK_QUALITY_RULES}

Guidelines for disambiguation:
- Group related requirements under coherent epics and features.
- Identify implicit groupings from context (e.g., authentication-related items belong together).
- Separate distinct concerns into different epics.
- Convert prose requirements into actionable task titles.
- Extract acceptance criteria from detailed descriptions.
- Do NOT include items that duplicate existing ones listed below.
${existingList}
Document to analyze:
---
${content.slice(0, 20_000)}
---

${OUTPUT_INSTRUCTION}`;
}

/**
 * Parse the LLM disambiguation response into Proposal objects.
 * Applies the standard source annotation and validates with Zod.
 */
function parseDisambiguationResponse(raw: string): Proposal[] {
  const jsonText = extractJson(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    // Try repair
    const repaired = repairTruncatedJson(jsonText);
    if (!repaired) return [];
    try {
      parsed = JSON.parse(repaired);
    } catch {
      return [];
    }
  }

  // Handle both array and single-object responses
  const arrayData = Array.isArray(parsed) ? parsed : [parsed];
  const result = DisambiguationResponseSchema.safeParse(arrayData);
  if (!result.success) return [];

  return result.data.map((item) => ({
    epic: { title: item.epic.title, source: SOURCE },
    features: item.features.map((f) => ({
      title: f.title,
      source: SOURCE,
      description: f.description,
      tasks: f.tasks.map((t) => makeTask(
        t.title,
        t.description,
        t.acceptanceCriteria,
      )),
    })),
  }));
}

/**
 * Attempt LLM disambiguation of ambiguous content.
 * Only called when useLLM is true and the pattern-recognition pass
 * produced ambiguous results.
 *
 * Falls back to the original (pattern-based) result on any LLM failure.
 */
async function disambiguateWithLLM(
  content: string,
  existingTitles: Set<string>,
  patternResult: ExtractionResult,
  model?: string,
): Promise<ExtractionResult> {
  const tokenUsage = emptyAnalyzeTokenUsage();

  try {
    const prompt = buildDisambiguationPrompt(content, existingTitles);
    const result = await spawnClaude(prompt, model ?? DEFAULT_MODEL);
    accumulateTokenUsage(tokenUsage, result.tokenUsage);

    const proposals = parseDisambiguationResponse(result.text);

    // If the LLM produced a meaningful result, use it
    if (proposals.length > 0) {
      // Filter out empty proposals (no features)
      const filtered = proposals.filter((p) => p.features.length > 0);
      if (filtered.length > 0) {
        return {
          proposals: filtered,
          usedLLM: true,
          tokenUsage,
          warnings: patternResult.warnings,
        };
      }
    }

    // LLM didn't produce useful results — fall back to pattern-based
    return { ...patternResult, tokenUsage };
  } catch {
    // LLM call failed — fall back to pattern-based results silently
    return patternResult;
  }
}

/**
 * Optionally enhance extraction results with LLM disambiguation.
 * Called at the end of both extractFromMarkdown and extractFromText
 * when useLLM is true and the result is ambiguous.
 */
export async function maybeDisambiguate(
  content: string,
  patternResult: ExtractionResult,
  options?: ExtractionOptions,
): Promise<ExtractionResult> {
  if (!options?.useLLM) return patternResult;
  if (!isAmbiguousStructure(patternResult.proposals, content)) return patternResult;

  const existingTitles = new Set(
    (options?.existingItems ?? []).map((item) => normalize(item.title)),
  );

  return disambiguateWithLLM(content, existingTitles, patternResult, options.model);
}
