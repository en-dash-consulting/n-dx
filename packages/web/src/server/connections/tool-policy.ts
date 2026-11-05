/**
 * Read/write class and run/ask/never policy for an external tool. Pure.
 *
 * Class comes from the server's annotations: `readOnlyHint: true` is a read;
 * anything else (`destructiveHint`, or no annotation) is a write, so an
 * unannotated tool errs toward write. Policy defaults from the class: a read
 * runs, a write asks. An operator overrides either per tool in the
 * connection's config (`tools: { "<tool>": { class?, policy? } }`); "run" on a
 * write happens only through such an override.
 *
 * An invalid override — an unknown class or policy, or a tool the server does
 * not list — is ignored with a warning naming it. Never throws.
 *
 * See docs/architecture/sidecar-connections.md.
 */

export type ToolClass = "read" | "write";
export type ToolRunPolicy = "run" | "ask" | "never";
/** Where a value came from: the server's annotation, the class default, or the operator. */
export type ToolSource = "annotation" | "default" | "override";

export const TOOL_CLASSES: readonly ToolClass[] = ["read", "write"];
export const TOOL_POLICIES: readonly ToolRunPolicy[] = ["run", "ask", "never"];

export interface ToolPolicy {
  class: ToolClass;
  /** `annotation` when `readOnlyHint` decided a read, `default` when no hint made it a write. */
  classSource: ToolSource;
  policy: ToolRunPolicy;
  /** `default` unless the operator set a policy. */
  policySource: ToolSource;
}

/** The part of an MCP tool this module reads. */
export interface PolicyTool {
  name: string;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

/** Class from annotations alone. */
export function annotatedClass(annotations: PolicyTool["annotations"]): { class: ToolClass; source: ToolSource } {
  if (annotations?.readOnlyHint === true) return { class: "read", source: "annotation" };
  // destructiveHint true is an explicit write; no hint is a write by default.
  return { class: "write", source: annotations?.destructiveHint === true ? "annotation" : "default" };
}

export function defaultPolicy(toolClass: ToolClass): ToolRunPolicy {
  return toolClass === "read" ? "run" : "ask";
}

function isOneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

/**
 * The policy of every tool in `tools`, by tool name. `overrides` is the raw
 * config value, so anything in it is checked here.
 */
export function resolveToolPolicies(
  tools: readonly PolicyTool[],
  overrides: unknown,
  warn: (message: string) => void = () => undefined,
): Map<string, ToolPolicy> {
  const valid = new Map<string, { class?: ToolClass; policy?: ToolRunPolicy }>();
  if (overrides !== undefined) {
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
      warn(`[connections] Ignoring tools overrides: tools must be an object keyed by tool name.`);
    } else {
      const listed = new Set(tools.map((tool) => tool.name));
      for (const [name, raw] of Object.entries(overrides)) {
        if (!listed.has(name)) {
          warn(`[connections] Ignoring override for tool ${JSON.stringify(name)}: the server does not list it.`);
          continue;
        }
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          warn(`[connections] Ignoring override for tool ${JSON.stringify(name)}: it must be an object.`);
          continue;
        }
        const entry = raw as Record<string, unknown>;
        const accepted: { class?: ToolClass; policy?: ToolRunPolicy } = {};
        if (entry.class !== undefined) {
          if (isOneOf(TOOL_CLASSES, entry.class)) accepted.class = entry.class;
          else warn(`[connections] Ignoring class override for tool ${JSON.stringify(name)}: ${JSON.stringify(entry.class)} is not "read" or "write".`);
        }
        if (entry.policy !== undefined) {
          if (isOneOf(TOOL_POLICIES, entry.policy)) accepted.policy = entry.policy;
          else warn(`[connections] Ignoring policy override for tool ${JSON.stringify(name)}: ${JSON.stringify(entry.policy)} is not "run", "ask" or "never".`);
        }
        valid.set(name, accepted);
      }
    }
  }

  const out = new Map<string, ToolPolicy>();
  for (const tool of tools) {
    const override = valid.get(tool.name);
    const base = annotatedClass(tool.annotations);
    const toolClass = override?.class ?? base.class;
    out.set(tool.name, {
      class: toolClass,
      classSource: override?.class ? "override" : base.source,
      policy: override?.policy ?? defaultPolicy(toolClass),
      policySource: override?.policy ? "override" : "default",
    });
  }
  return out;
}
