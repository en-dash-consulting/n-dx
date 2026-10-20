/**
 * Resolve a resource's audit attributes in one module instance.
 *
 * A reusable module writes `engine = var.engine`; the literal arrives through
 * a module call (`engine = "postgres"`), possibly passed down several calls.
 * Resolution follows exactly these forms, and strings only:
 *
 * - a plain quoted string, which is the value;
 * - `var.x`: the argument the instance's call passes, resolved in the calling
 *   instance, or, when the call does not pass it, the variable's `default` if
 *   that is a plain string;
 * - `local.x`: the local's expression, resolved in the same instance;
 * - `cond ? null : e` and `cond ? e : null`: `e`, with `conditional` confidence.
 *
 * Anything else (functions, interpolation, arithmetic, other references) does
 * not resolve and the attribute stays as written. Passing a `var.x` moves to
 * the parent instance, so it ends at a root; a local that reaches itself again
 * in the same instance stops there (a cycle).
 *
 * @module lang-terraform/terraform-resolve
 */

import type { ResolvedAttribute, ResourceAttributes, SourceLocation } from "@n-dx/lang-kit";
import {
  isPlainString,
  valueAsWritten,
  type TerraformExpression,
  type TerraformLocal,
  type TerraformModel,
  type TerraformResource,
  type TerraformVariable,
} from "./terraform-model.js";

/** A resolved string and how it was reached. */
export interface Resolution {
  readonly value: string;
  readonly confidence: ResolvedAttribute["confidence"];
  readonly from: SourceLocation;
}

/** What one instance makes of a resource's expressions: the resolved fields only. */
export interface ResolvedResource {
  readonly attributes: Partial<Record<keyof ResourceAttributes, string>>;
  readonly resolved: Partial<Record<keyof ResourceAttributes, ResolvedAttribute>>;
}

const IDENT = "[A-Za-z_][A-Za-z0-9_-]*";
const VARIABLE = new RegExp(`^var\\.(${IDENT})$`);
const LOCAL = new RegExp(`^local\\.(${IDENT})$`);

/**
 * The branches of a top-level conditional `cond ? a : b`, or undefined. Quoted
 * strings (with their `${…}` templates) and brackets are skipped, so a `?` or
 * `:` inside them does not count; a nested conditional in `a` is matched.
 */
export function conditionalBranches(expression: string): readonly [string, string] | undefined {
  const stack: string[] = [];
  let question = -1;
  let pending = 0;
  for (let i = 0; i < expression.length; i++) {
    const ch = expression[i];
    if (stack.at(-1) === '"') {
      if (ch === "\\") i++;
      else if (ch === '"') stack.pop();
      else if ((ch === "$" || ch === "%") && expression[i + 1] === "{") {
        stack.push("{");
        i++;
      }
      continue;
    }
    if (ch === '"' || ch === "(" || ch === "[" || ch === "{") stack.push(ch);
    else if (ch === ")" || ch === "]" || ch === "}") stack.pop();
    else if (stack.length > 0) continue;
    else if (ch === "?") {
      if (question < 0) question = i;
      pending++;
    } else if (ch === ":" && question >= 0 && --pending === 0) {
      return [expression.slice(question + 1, i).trim(), expression.slice(i + 1).trim()];
    }
  }
  return undefined;
}

/** Resolves expressions in the instances of one model; indexes are built once. */
export class TerraformResolver {
  private readonly variables = new Map<string, TerraformVariable>();
  private readonly locals = new Map<string, TerraformLocal>();

  constructor(private readonly model: TerraformModel) {
    // The first declaration of a name in a directory wins, as everywhere in the model.
    for (const v of model.variables) if (!this.variables.has(key(v.directory, v.name))) this.variables.set(key(v.directory, v.name), v);
    for (const l of model.locals) if (!this.locals.has(key(l.directory, l.name))) this.locals.set(key(l.directory, l.name), l);
  }

  /** The resource's expressions that resolve in `instance` (an index into `model.instances`). */
  resolveResource(resource: TerraformResource, instance: number): ResolvedResource {
    const attributes: ResolvedResource["attributes"] = {};
    const resolved: ResolvedResource["resolved"] = {};
    const at = { file: resource.file, line: resource.span.start.line };
    for (const [field, written] of Object.entries(resource.expressions ?? {}) as Array<[keyof ResourceAttributes, string]>) {
      const resolution = this.resolve(written, instance, new Set(), at);
      if (resolution === undefined) continue;
      attributes[field] = resolution.value;
      resolved[field] = { written, confidence: resolution.confidence, from: resolution.from };
    }
    return { attributes, resolved };
  }

  /**
   * `expression` in `instance`. `at` is where the expression is written, the
   * place a plain string is reported from (a resource's own string: the
   * resource's first line); `visiting` holds the locals being resolved in this
   * chain, per instance.
   */
  resolve(expression: string, instance: number, visiting: Set<string>, at: SourceLocation): Resolution | undefined {
    const text = expression.trim();
    if (isPlainString(text)) return { value: valueAsWritten(text), confidence: "literal", from: at };
    const branches = conditionalBranches(text);
    if (branches !== undefined) {
      const [whenTrue, whenFalse] = branches;
      const other = whenTrue === "null" ? whenFalse : whenFalse === "null" ? whenTrue : undefined;
      if (other === undefined || other === "null") return undefined;
      const inner = this.resolve(other, instance, visiting, at);
      return inner === undefined ? undefined : { ...inner, confidence: "conditional" };
    }
    const { directory } = this.model.instances[instance];
    const variable = VARIABLE.exec(text)?.[1];
    if (variable !== undefined) return this.resolveVariable(variable, instance, directory);
    const local = LOCAL.exec(text)?.[1];
    if (local === undefined) return undefined;
    const declared = this.locals.get(key(directory, local));
    const guard = `${instance}\0${local}`;
    if (declared?.value === undefined || visiting.has(guard)) return undefined;
    visiting.add(guard);
    try {
      return this.resolve(declared.value.expression, instance, visiting, located(declared.file, declared.value));
    } finally {
      visiting.delete(guard);
    }
  }

  private resolveVariable(name: string, instance: number, directory: string): Resolution | undefined {
    const { parent, call } = this.model.instances[instance];
    if (parent !== undefined && call !== undefined) {
      const site = this.model.modules[call];
      const passed = site.arguments !== undefined && Object.hasOwn(site.arguments, name) ? site.arguments[name] : undefined;
      // A passed argument is resolved in the caller; locals there start a fresh chain.
      if (passed !== undefined) return this.resolve(passed.expression, parent, new Set(), located(site.file, passed));
    }
    const declared = this.variables.get(key(directory, name));
    const fallback = declared?.default;
    if (declared === undefined || fallback === undefined || !isPlainString(fallback.expression.trim())) return undefined;
    return { value: valueAsWritten(fallback.expression.trim()), confidence: "literal", from: located(declared.file, fallback) };
  }
}

const key = (directory: string, name: string): string => `${directory}\0${name}`;

const located = (file: string, expression: TerraformExpression): SourceLocation => ({ file, line: expression.line });
