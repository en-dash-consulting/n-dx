/**
 * Argument parsing for the rex CLI.
 *
 * `flags` holds the last value of each flag; `multiFlags` holds every value
 * of a repeatable flag. Aliased spellings land under one canonical key.
 */

/** Keys that accept multiple values (accumulated into arrays). */
const MULTI_VALUE_KEYS = new Set(["file", "criterion", "capability-criterion", "remove-capability-criterion"]);

/**
 * Comma-separated list keys: a repeated flag appends to the list rather than
 * replacing it, so `--blocked-by=a --blocked-by=b,c` reads as `a,b,c`.
 */
const CSV_LIST_KEYS = new Set(["blockedBy"]);

/** Alternative spellings, mapped to the key commands read. */
const FLAG_ALIASES: Record<string, string> = {
  "blocked-by": "blockedBy",
};

/** Keys that expect a following value when provided as `--key value`. */
const VALUE_KEYS = new Set([
  "model",
  "format",
  "parent",
  "area",
  "title",
  "description",
  "status",
  "priority",
  "epic",
  "chunk",
  "chunk-size",
  "acknowledge",
  "direction",
  "output",
  "out",
  "in",
  "host",
  "port",
  "group-by",
  "accept-llm",
  "detail",
  "run",
  "source",
  "type",
  "target",
  "relation",
  "under",
  "summary",
  "migration",
  "cut-at",
  "before",
  "after",
  "proposed",
  "statement",
  ...CSV_LIST_KEYS,
  ...MULTI_VALUE_KEYS,
]);

export interface ParsedArgs {
  command: string | undefined;
  positional: string[];
  flags: Record<string, string>;
  multiFlags: Record<string, string[]>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string> = {};
  const multiFlags: Record<string, string[]> = {};
  const positional: string[] = [];
  let command: string | undefined;

  const setFlag = (key: string, val: string): void => {
    if (MULTI_VALUE_KEYS.has(key)) {
      (multiFlags[key] ??= []).push(val);
    }
    flags[key] = CSV_LIST_KEYS.has(key) && flags[key] !== undefined ? `${flags[key]},${val}` : val;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const rawKey = eq !== -1 ? arg.slice(2, eq) : arg.slice(2);
      const key = FLAG_ALIASES[rawKey] ?? rawKey;
      if (eq !== -1) {
        setFlag(key, arg.slice(eq + 1));
      } else {
        const next = argv[i + 1];
        if (VALUE_KEYS.has(key) && next && !next.startsWith("-")) {
          setFlag(key, next);
          i++; // consume the value token
        } else {
          flags[key] = "true";
        }
      }
    } else if (arg === "-h") {
      flags.help = "true";
    } else if (arg === "-q") {
      flags.quiet = "true";
    } else if (arg === "-y") {
      flags.yes = "true";
    } else if (!command) {
      command = arg;
    } else {
      positional.push(arg);
    }
  }

  return { command, positional, flags, multiFlags };
}
