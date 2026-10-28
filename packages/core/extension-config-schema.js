/**
 * The JSON Schema check behind an extension's `configSchema`
 * (docs/architecture/extensions.md, "Config").
 *
 * It covers the validation keywords a config section needs — types, enums,
 * object properties, arrays, string and number bounds, and the `allOf` /
 * `anyOf` / `oneOf` / `not` combinators — and treats annotations (`title`,
 * `description`, `default`, `format`, …) as the spec does, as information.
 * A schema that uses any other keyword (`$ref`, `if`, `patternProperties`, …)
 * is refused when it is compiled, so a rule n-dx cannot check is reported
 * instead of silently passing.
 *
 * The config sections themselves are read and written by config.js, which
 * takes {@link configCheckerByName} from cli.js as an injected callback (see
 * the seam registry in packages/core/AGENTS.md).
 *
 * @module n-dx/extension-config-schema
 */

import * as nodeFs from "node:fs";
import { join } from "node:path";
import { discoverExtensions } from "./extension-discovery.js";
import { RESERVED_EXTENSION_NAMES } from "./extension-manifest.js";

/** Keywords that describe a value without constraining it. */
const ANNOTATIONS = new Set([
  "$schema", "$id", "$comment", "title", "description", "default", "examples",
  "deprecated", "readOnly", "writeOnly", "format",
]);

/** Keywords whose value is a schema. */
const SCHEMA_KEYWORDS = new Set(["additionalProperties", "items", "not"]);

/** Keywords whose value is a non-empty array of schemas. */
const SCHEMA_LIST_KEYWORDS = new Set(["allOf", "anyOf", "oneOf"]);

/** Keywords whose value is a number. */
const NUMBER_KEYWORDS = new Set([
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
  "minLength", "maxLength", "minItems", "maxItems",
]);

const OTHER_KEYWORDS = new Set(["type", "enum", "const", "properties", "required", "uniqueItems", "pattern"]);

const TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);

/**
 * A rule a value breaks. `keyword` is the JSON Schema keyword that failed.
 *
 * @typedef {{keyword: string, message: string}} SchemaViolation
 */

/**
 * One extension's schema, ready to use on its config section.
 *
 * @typedef {object} ExtensionConfigChecker
 * @property {(parts: string[]) => string | string[] | undefined} typeAt  The
 *   `type` the schema declares for a key path inside the section, when it
 *   spells one out through `properties`.
 * @property {(section: unknown) => SchemaViolation[]} check  What the section
 *   breaks; a schema that cannot be read or checked is one violation with the
 *   keyword `schema`.
 */

/**
 * The checker for a valid extension: its `configSchema`, or nothing to check
 * when the manifest names none.
 *
 * @param {import("./extension-discovery.js").DiscoveredExtension} ext
 * @param {Pick<typeof nodeFs, "readFileSync">} [fs]
 * @returns {ExtensionConfigChecker}
 */
export function configCheckerFor(ext, fs = nodeFs) {
  const rel = ext.manifest?.configSchema;
  if (!rel) return { typeAt: () => undefined, check: () => [] };
  const path = join(ext.dir, rel);
  let schema;
  try {
    schema = JSON.parse(fs.readFileSync(path, "utf-8"));
  } catch (err) {
    return brokenChecker(`its configSchema ${path} cannot be read (${err.code ?? err.message})`);
  }
  let validate;
  try {
    validate = compileConfigSchema(schema);
  } catch (err) {
    return brokenChecker(`its configSchema ${path} cannot be checked (${err.message})`);
  }
  return { typeAt: (parts) => schemaTypeAt(schema, parts), check: validate };
}

/**
 * @typedef {object} CheckerByNameOptions
 * @property {Iterable<string>} builtinCommands  Every built-in `ndx` command and tool delegation.
 * @property {string} projectDir  The project for the `project` source.
 * @property {string} home  The n-dx home.
 */

/**
 * The checker for the installed extension `name`, or why there is none: it is
 * not installed, or its manifest is not valid. A reserved name is `refused`
 * rather than an `error`, since no extension can take it and `--force` must
 * not write it: `extensions.paths` is discovery's list of dev paths.
 *
 * @param {string} name
 * @param {CheckerByNameOptions} options
 * @returns {{checker: ExtensionConfigChecker} | {error: string} | {refused: string}}
 */
export function configCheckerByName(name, options) {
  if (RESERVED_EXTENSION_NAMES.includes(name)) {
    return { refused: `"${name}" is reserved, so extensions.${name} is not an extension's config section` };
  }
  const { extensions } = discoverExtensions(options);
  const named = extensions.filter((e) => e.name === name);
  const ext = named.find((e) => e.manifest);
  if (ext) return { checker: configCheckerFor(ext) };
  if (named.length > 0) {
    return { error: `Extension "${name}" is ${named[0].status}, so its configSchema cannot be checked — fix: ndx extensions doctor` };
  }
  return { error: `No installed extension is named "${name}" — fix: ndx extensions list` };
}

/** @returns {ExtensionConfigChecker} */
function brokenChecker(message) {
  return { typeAt: () => undefined, check: () => [{ keyword: "schema", message }] };
}

/** Declared types along properties, map values, array items and combinators. */
function schemaTypeAt(schema, parts) {
  if (!isPlainObject(schema)) return undefined;
  const types = new Set();
  const add = (value) => { for (const type of Array.isArray(value) ? value : value ? [value] : []) types.add(type); };
  if (parts.length === 0) add(schema.type);
  else {
    const [part, ...rest] = parts;
    const properties = isPlainObject(schema.properties) ? schema.properties : {};
    if (Object.hasOwn(properties, part)) add(schemaTypeAt(properties[part], rest));
    else if (/^(0|[1-9][0-9]*)$/.test(part) && schema.items) add(schemaTypeAt(schema.items, rest));
    else add(schemaTypeAt(schema.additionalProperties, rest));
  }
  for (const key of ["allOf", "anyOf", "oneOf"]) {
    for (const branch of schema[key] ?? []) add(schemaTypeAt(branch, parts));
  }
  return types.size === 0 ? undefined : types.size === 1 ? [...types][0] : [...types];
}

/**
 * Check `schema` and return a function that lists what a value breaks.
 * Throws an `Error` naming the first part of the schema it cannot check.
 *
 * @param {unknown} schema
 * @returns {(value: unknown) => SchemaViolation[]}
 */
export function compileConfigSchema(schema) {
  assertSchema(schema, "#");
  return (value) => {
    /** @type {SchemaViolation[]} */
    const violations = [];
    check(/** @type {object | boolean} */ (schema), value, [], violations);
    return violations;
  };
}

function assertSchema(node, at) {
  if (typeof node === "boolean") return;
  if (!isPlainObject(node)) throw new Error(`${at} is not a schema`);
  for (const [key, value] of Object.entries(node)) {
    const here = `${at}/${key}`;
    if (ANNOTATIONS.has(key)) continue;
    if (SCHEMA_KEYWORDS.has(key)) {
      if (key === "items" && Array.isArray(value)) throw new Error(`${here}: tuple items are not supported`);
      assertSchema(value, here);
    } else if (SCHEMA_LIST_KEYWORDS.has(key)) {
      if (!Array.isArray(value) || value.length === 0) throw new Error(`${here} must be a non-empty array of schemas`);
      value.forEach((item, i) => assertSchema(item, `${here}/${i}`));
    } else if (NUMBER_KEYWORDS.has(key)) {
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${here} must be a number`);
    } else if (key === "type") {
      const types = Array.isArray(value) ? value : [value];
      if (types.length === 0 || !types.every((t) => TYPES.has(t))) throw new Error(`${here} must name JSON types`);
    } else if (key === "enum") {
      if (!Array.isArray(value)) throw new Error(`${here} must be an array`);
    } else if (key === "properties") {
      if (!isPlainObject(value)) throw new Error(`${here} must be an object`);
      for (const [name, sub] of Object.entries(value)) assertSchema(sub, `${here}/${name}`);
    } else if (key === "required") {
      if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) throw new Error(`${here} must be an array of names`);
    } else if (key === "uniqueItems") {
      if (typeof value !== "boolean") throw new Error(`${here} must be a boolean`);
    } else if (key === "pattern") {
      if (typeof value !== "string") throw new Error(`${here} must be a string`);
      try {
        new RegExp(value, "u");
      } catch (err) {
        throw new Error(`${here} is not a valid pattern (${/** @type {Error} */ (err).message})`);
      }
    } else if (!OTHER_KEYWORDS.has(key)) {
      throw new Error(`${here}: "${key}" is not a keyword n-dx checks`);
    }
  }
}

/**
 * @param {object | boolean} schema
 * @param {unknown} value
 * @param {string[]} path
 * @param {SchemaViolation[]} out
 */
function check(schema, value, path, out) {
  const fail = (keyword, message) => {
    out.push({ keyword, message: `${path.length > 0 ? path.join(".") : "the section"} ${message}` });
  };
  if (schema === true) return;
  if (schema === false) {
    fail("false", "is not allowed");
    return;
  }
  const s = /** @type {Record<string, any>} */ (schema);

  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((t) => isType(value, t))) {
      fail("type", `must be ${types.join(" or ")}`);
      return;
    }
  }
  if (s.enum !== undefined && !s.enum.some((v) => equal(v, value))) {
    fail("enum", `must be one of: ${s.enum.map((v) => JSON.stringify(v)).join(", ")}`);
  }
  if (s.const !== undefined && !equal(s.const, value)) fail("const", `must be ${JSON.stringify(s.const)}`);

  if (typeof value === "number") {
    if (s.minimum !== undefined && value < s.minimum) fail("minimum", `must be >= ${s.minimum}`);
    if (s.maximum !== undefined && value > s.maximum) fail("maximum", `must be <= ${s.maximum}`);
    if (s.exclusiveMinimum !== undefined && value <= s.exclusiveMinimum) fail("exclusiveMinimum", `must be > ${s.exclusiveMinimum}`);
    if (s.exclusiveMaximum !== undefined && value >= s.exclusiveMaximum) fail("exclusiveMaximum", `must be < ${s.exclusiveMaximum}`);
    if (s.multipleOf !== undefined && !isWholeMultiple(value, s.multipleOf)) fail("multipleOf", `must be a multiple of ${s.multipleOf}`);
  }

  if (typeof value === "string") {
    const length = [...value].length;
    if (s.minLength !== undefined && length < s.minLength) fail("minLength", `must have at least ${s.minLength} characters`);
    if (s.maxLength !== undefined && length > s.maxLength) fail("maxLength", `must have at most ${s.maxLength} characters`);
    if (s.pattern !== undefined && !new RegExp(s.pattern, "u").test(value)) fail("pattern", `must match ${s.pattern}`);
  }

  if (Array.isArray(value)) {
    if (s.minItems !== undefined && value.length < s.minItems) fail("minItems", `must have at least ${s.minItems} items`);
    if (s.maxItems !== undefined && value.length > s.maxItems) fail("maxItems", `must have at most ${s.maxItems} items`);
    if (s.uniqueItems === true && value.some((v, i) => value.findIndex((w) => equal(v, w)) !== i)) fail("uniqueItems", "must not repeat items");
    if (s.items !== undefined) value.forEach((item, i) => check(s.items, item, [...path, String(i)], out));
  }

  if (isPlainObject(value)) {
    for (const name of s.required ?? []) {
      if (!Object.hasOwn(value, name)) fail("required", `must have the property "${name}"`);
    }
    const properties = s.properties ?? {};
    for (const [name, item] of Object.entries(value)) {
      if (Object.hasOwn(properties, name)) check(properties[name], item, [...path, name], out);
      else if (s.additionalProperties === false) fail("additionalProperties", `must not have the property "${name}"`);
      else if (s.additionalProperties !== undefined) check(s.additionalProperties, item, [...path, name], out);
    }
  }

  const passes = (sub) => {
    const inner = [];
    check(sub, value, path, inner);
    return inner.length === 0;
  };
  for (const sub of s.allOf ?? []) check(sub, value, path, out);
  if (s.anyOf !== undefined && !s.anyOf.some(passes)) fail("anyOf", "must match one of the anyOf schemas");
  if (s.oneOf !== undefined && s.oneOf.filter(passes).length !== 1) fail("oneOf", "must match exactly one of the oneOf schemas");
  if (s.not !== undefined && passes(s.not)) fail("not", "must not match the \"not\" schema");
}

function isType(value, type) {
  switch (type) {
    case "object": return isPlainObject(value);
    case "array": return Array.isArray(value);
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return Number.isInteger(value);
    case "boolean": return typeof value === "boolean";
    case "null": return value === null;
    default: return false;
  }
}

/** Tolerant of binary fractions: 0.3 is a multiple of 0.1. */
function isWholeMultiple(value, divisor) {
  const quotient = value / divisor;
  return Math.abs(quotient - Math.round(quotient)) < 1e-9;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** JSON equality: same type, same items, same keys with equal values. */
function equal(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => equal(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && equal(a[k], b[k]));
  }
  return false;
}
