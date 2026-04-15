export interface ClassificationResult {
  intent: "add" | "remove" | "modify" | "restructure" | "unknown";
  target?: string;
}

const ADD_PATTERNS = /\b(add|create|include|introduce|insert|append|new)\b/i;
const REMOVE_PATTERNS = /\b(remove|delete|drop|omit|exclude|eliminate|cut)\b/i;
const MODIFY_PATTERNS = /\b(change|update|modify|rename|set|adjust|increase|decrease|rewrite|revise|rephrase|move)\b/i;
const RESTRUCTURE_PATTERNS = /\b(split|merge|combine|consolidate|reorganize|restructure|separate|break\s*down|flatten|group|regroup|rearrange)\b/i;

export function classifyModificationRequest(
  request: string,
): ClassificationResult {
  const trimmed = request.trim();

  if (RESTRUCTURE_PATTERNS.test(trimmed)) {
    return { intent: "restructure", target: extractTarget(trimmed, RESTRUCTURE_PATTERNS) };
  }

  if (ADD_PATTERNS.test(trimmed)) {
    return { intent: "add", target: extractTarget(trimmed, ADD_PATTERNS) };
  }

  if (REMOVE_PATTERNS.test(trimmed)) {
    return { intent: "remove", target: extractTarget(trimmed, REMOVE_PATTERNS) };
  }

  if (MODIFY_PATTERNS.test(trimmed)) {
    return { intent: "modify", target: extractTarget(trimmed, MODIFY_PATTERNS) };
  }

  return { intent: "unknown" };
}

function extractTarget(request: string, verbPattern: RegExp): string | undefined {
  const match = request.match(verbPattern);
  if (!match) return undefined;

  const verbEnd = (match.index ?? 0) + match[0].length;
  const rest = request.slice(verbEnd).trim();
  const cleaned = rest.replace(/^(the|a|an|of|for|from|to|into|in)\s+/gi, "");

  if (!cleaned) return undefined;
  return cleaned.length > 50 ? `${cleaned.slice(0, 50)}...` : cleaned;
}
