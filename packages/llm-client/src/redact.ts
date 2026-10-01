/**
 * Credential redaction for text that is about to be persisted or shown.
 *
 * Agent run records hold everything a tool printed — a `cat .env`, a failing
 * `curl` with its header echoed back, a stack trace with a connection string.
 * Those records live in `.hench/runs/`, are served by the dashboard and can
 * be exported. The environment filter in hench keeps credential-shaped
 * *variables* away from child processes, but it cannot stop a command from
 * printing a secret it read from a file. This module scrubs the text itself.
 *
 * Two kinds of rule, applied in order:
 *
 * 1. **Well-known token shapes** — vendor prefixes (`sk-ant-…`, `ghp_…`,
 *    `AKIA…`, `xoxb-…`), JWTs, private-key blocks, bearer headers and URL
 *    userinfo. These need no key to be recognised.
 * 2. **Credential-shaped assignments** — `KEY=value`, `key: value` or
 *    `"key": "value"` where the key *ends* in a sensitive word (`token`,
 *    `secret`, `password`, `api_key`, `access_key`, …). The key is kept, the
 *    value replaced. The suffix rule, and the requirement that the value hold
 *    a letter, keep run-record fields such as `tokenUsage`, `totalTokens` or
 *    `tokenDiagnosticStatus` untouched.
 *
 * Redaction is best-effort by nature — a secret split across two output
 * chunks or encoded unusually will slip through — so it is a floor, not a
 * guarantee, and callers should still treat run records as sensitive.
 */

export const REDACTED_TOKEN = "[redacted:token]";
export const REDACTED_VALUE = "[redacted:value]";
export const REDACTED_KEY_BLOCK = "[redacted:private-key]";
export const REDACTED_PASSWORD = "[redacted:password]";

interface Rule {
  kind: string;
  pattern: RegExp;
  replace: string | ((...groups: string[]) => string);
}

const RULES: readonly Rule[] = [
  {
    kind: "private-key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: REDACTED_KEY_BLOCK,
  },
  {
    // Vendor-prefixed API keys and tokens. Each prefix is followed by a long
    // run of token characters; the minimum lengths keep short identifiers
    // such as "sk-test" alone.
    kind: "token",
    pattern: new RegExp(
      [
        "sk-ant-[A-Za-z0-9_-]{20,}",
        "sk-proj-[A-Za-z0-9_-]{20,}",
        "sk-[A-Za-z0-9]{32,}",
        "gh[pousr]_[A-Za-z0-9]{36}",
        "github_pat_[A-Za-z0-9_]{22,}",
        "glpat-[A-Za-z0-9_-]{20,}",
        "xox[abprs]-[A-Za-z0-9-]{10,}",
        "(?:AKIA|ASIA)[0-9A-Z]{16}",
        "AIza[0-9A-Za-z_-]{35}",
        "ya29\\.[A-Za-z0-9_-]{20,}",
        "npm_[A-Za-z0-9]{36}",
        "hf_[A-Za-z0-9]{30,}",
        "eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}",
      ].join("|"),
      "g",
    ),
    replace: REDACTED_TOKEN,
  },
  {
    kind: "bearer",
    pattern: /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/g,
    replace: (_m: string, prefix: string) => `${prefix}${REDACTED_TOKEN}`,
  },
  {
    // user:password@host in a URL. The user is kept — it is often a service
    // name — and only the password goes.
    kind: "url-password",
    pattern: /(\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:)([^/\s@]+)(@)/gi,
    replace: (_m: string, before: string, _pw: string, at: string) => `${before}${REDACTED_PASSWORD}${at}`,
  },
  {
    // key=value / key: value / "key": "value" where the key ends in a
    // sensitive word (with or without a prefix, so both `password=` and
    // `GITHUB_TOKEN=` match). The value must be at least 8 characters and
    // contain a letter, so counters and ids are not mistaken for secrets, and
    // an already-redacted marker is left alone so the pass is idempotent.
    kind: "assignment",
    pattern:
      /(\b[A-Za-z0-9_.-]*?(?:token|secret|password|passwd|api[_-]?key|apikey|private[_-]?key|credentials?|(?:secret|access)[_-]?key)\b["']?\s*[=:]\s*["']?)((?!\[redacted:)(?=[^\s"',;]*[A-Za-z])[^\s"',;]{8,})/gi,
    replace: (_m: string, head: string) => `${head}${REDACTED_VALUE}`,
  },
];

export interface RedactionResult {
  text: string;
  /** How many replacements were made, across all rules. */
  count: number;
  /** Which kinds fired, in rule order, without repeats. */
  kinds: string[];
}

/** Redact and report what was found. */
export function redactSecretsDetailed(text: string): RedactionResult {
  let out = text;
  let count = 0;
  const kinds: string[] = [];
  for (const rule of RULES) {
    let fired = 0;
    out = out.replace(rule.pattern, (...args: unknown[]) => {
      fired += 1;
      const groups = args.slice(0, -2) as string[];
      return typeof rule.replace === "string" ? rule.replace : rule.replace(...groups);
    });
    if (fired > 0) {
      count += fired;
      kinds.push(rule.kind);
    }
  }
  return { text: out, count, kinds };
}

/** Redact credential-shaped content in `text`. Idempotent. */
export function redactSecrets(text: string): string {
  return redactSecretsDetailed(text).text;
}

/**
 * Redact every string inside a JSON-like value, returning a new value with
 * the same shape. Non-string leaves are returned as they are; keys are not
 * redacted, only values.
 */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redactSecrets(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactDeep(v);
    return out as T;
  }
  return value;
}
