/**
 * Maven `${…}` property interpolation over one pom's effective properties.
 *
 * Every property is expanded at most once per context, failures included, so
 * the cost of reading a pom is linear in its properties however many values
 * reference them. Not re-exported from the package entry; `java-maven-build.ts`
 * is its consumer and re-exports the caps.
 */

import type { BuildValue } from "./build-model.js";

/**
 * The longest value interpolation builds. Properties that each reference the
 * next twice expand to 2^n characters from a few hundred bytes of pom; no real
 * coordinate or version comes near this.
 */
export const MAX_PROPERTY_EXPANSION = 4096;

/**
 * The most properties one expansion may pass through, each referencing the
 * next. Resolution recurses once per level, so a long chain from a small pom
 * would otherwise overflow the stack; real poms nest a handful of levels.
 */
export const MAX_PROPERTY_NESTING = 64;

const EXPANSION_TOO_LARGE: BuildValue = { resolved: false, reason: "property expansion too large" };
const NESTING_TOO_DEEP: BuildValue = { resolved: false, reason: "property nesting too deep" };

/** Marks a property whose expansion is under way: meeting it again closes a cycle. */
const EXPANDING = Symbol("expanding");

/**
 * A property's expansion. `height` is how many properties a fresh walk from
 * it enters, itself included: every chain for a value, the chains up to the
 * failing one for a failure. A cached result is reused only where a fresh walk
 * would also stay within `MAX_PROPERTY_NESTING`, so neither a value nor a
 * failure's reason depends on which reference reached the property first.
 * The exception is a cycle member: its height counts the walk only as far as
 * the member that closed the cycle, so close to the cap it can report the
 * cycle where a fresh walk from it would report nesting too deep.
 */
interface Expansion {
  value: BuildValue;
  height: number;
}

export interface PropertyContext {
  props: ReadonlyMap<string, string>;
  builtins: ReadonlyMap<string, string>;
  /** Out-of-repository parents and BOMs, named when a property is not found. */
  external: readonly string[];
  /** Each property's expansion in this context, or `EXPANDING` while it is under way. */
  expansions: Map<string, Expansion | typeof EXPANDING>;
}

export function propertyContext(
  props: ReadonlyMap<string, string>,
  builtins: ReadonlyMap<string, string> = new Map(),
  external: readonly string[] = [],
): PropertyContext {
  return { props, builtins, external, expansions: new Map() };
}

/**
 * Replace every `${name}` in `text`. Built-ins (`project.version`, …) are
 * consulted first, then properties. A name found nowhere makes the whole
 * value unresolved; when an out-of-repository parent or BOM exists the reason
 * names it, since the property may be defined there. A text with a
 * placeholder that expands past `MAX_PROPERTY_EXPANSION`, or nests more than
 * `MAX_PROPERTY_NESTING` properties deep, is unresolved; a literal with none
 * is returned as written.
 */
export function interpolate(text: string, ctx: PropertyContext): BuildValue {
  return expand(text, ctx, 0).value;
}

/** `text` expanded with `depth` properties already under way above it. */
function expand(text: string, ctx: PropertyContext, depth: number): Expansion {
  let out = "";
  let i = 0;
  let height = 0;
  let expanded = false;
  while (i < text.length) {
    const open = text.indexOf("${", i);
    if (open < 0) break;
    const close = text.indexOf("}", open);
    if (close < 0) return failed(`unterminated placeholder in "${text}"`, height);
    const property = resolveProperty(text.slice(open + 2, close), ctx, depth);
    height = Math.max(height, property.height);
    if (!property.value.resolved) return { value: property.value, height };
    out += text.slice(i, open) + property.value.value;
    // Checked per placeholder so a runaway expansion stops before it is built.
    if (out.length > MAX_PROPERTY_EXPANSION) return { value: EXPANSION_TOO_LARGE, height };
    expanded = true;
    i = close + 1;
  }
  out += text.slice(i);
  if (expanded && out.length > MAX_PROPERTY_EXPANSION) return { value: EXPANSION_TOO_LARGE, height };
  return { value: { resolved: true, value: out }, height };
}

/**
 * One `${name}`, expanded once per context. Results are cached, failures too:
 * a property that is undefined, unterminated, too large or in a cycle fails
 * the same way wherever a walk reaches it within the cap. A cycle's reason
 * names the property that closed it, so a member reached later reports the
 * same one. Nesting too deep is cached only for a property reached at depth
 * 0, where its height is exact; deeper, the height is only a lower bound, so
 * the property is left to be walked again, and that walk is bounded by the cap.
 */
function resolveProperty(name: string, ctx: PropertyContext, depth: number): Expansion {
  const entry = ctx.expansions.get(name);
  // Checked before the cap, as an undefined name is: neither enters a level.
  if (entry === EXPANDING) return failed(`property ${name} refers to itself`, 0);
  if (entry) return depth + entry.height > MAX_PROPERTY_NESTING ? { value: NESTING_TOO_DEEP, height: entry.height } : entry;
  const raw = ctx.builtins.get(name) ?? ctx.props.get(name);
  if (raw === undefined) {
    const hint = ctx.external.length ? `; may be defined by ${ctx.external.join(", ")}` : "";
    const missing = failed(`property ${name} is not defined in the repository${hint}`, 0);
    ctx.expansions.set(name, missing);
    return missing;
  }
  if (depth >= MAX_PROPERTY_NESTING) return { value: NESTING_TOO_DEEP, height: 1 };
  ctx.expansions.set(name, EXPANDING);
  const inner = expand(raw, ctx, depth + 1);
  const result = { value: inner.value, height: inner.height + 1 };
  if (result.value === NESTING_TOO_DEEP && depth > 0) ctx.expansions.delete(name);
  else ctx.expansions.set(name, result);
  return result;
}

function failed(reason: string, height: number): Expansion {
  return { value: { resolved: false, reason }, height };
}
