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
 *    `AKIA…`, `xoxb-…`, `ATBB…`), JWTs, private-key blocks, `Bearer` and
 *    `Basic` headers, `-u user:password` flags and URL userinfo. These need no
 *    key to be recognised.
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
 *
 * Credentials with no distinctive shape are reached only by rule 2. A
 * Bitbucket app password issued before the `ATBB` prefix, or a Bitbucket Data
 * Center token issued before `BBDC-`, is an unbroken run of alphanumerics
 * indistinguishable from a commit SHA or a content hash; matching bare runs of
 * that shape would redact a large part of a normal run record, so it is not
 * done. Such a credential is caught when it appears behind a key
 * (`BITBUCKET_APP_PASSWORD=…`), in URL userinfo, behind `-u`, or inside a
 * `Basic` header — which covers how one is actually used — and not when it is
 * printed bare.
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

// The key half of an assignment: a name ending in a sensitive word, with or
// without a prefix, so both `password=` and `GITHUB_TOKEN=` match. Written
// once and shared by the two assignment rules, which must agree on what a
// key is.
const ASSIGNMENT_KEY = "\\b[A-Za-z0-9_.-]*?(?:token|secret|password|passwd|api[_-]?key|apikey|private[_-]?key|credentials?|(?:secret|access)[_-]?key)\\b";

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
        // Atlassian stamps a fixed prefix on each credential kind: ATBB on a
        // Bitbucket Cloud app password, ATCTT on a scoped Bitbucket access
        // token (repository, project or workspace), ATATT on an Atlassian API
        // token — the credential that is replacing app passwords for the
        // Bitbucket Cloud API — and BBDC- on a Bitbucket Data Center HTTP
        // access token. The newer ones end in `=` plus a checksum, so `=` is
        // part of the body.
        "ATBB[A-Za-z0-9]{20,}",
        "AT(?:CT|AT)T[A-Za-z0-9_=-]{20,}",
        "BBDC-[A-Za-z0-9]{20,}",
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
    // `Authorization: Basic <base64(user:password)>` — how Bitbucket Cloud's
    // own documentation sends an app password, and the one place a credential
    // travels with no recognisable shape of its own. Nothing else looks inside
    // a Basic header, so without this the app password lands in the log whole.
    //
    // The floor is 20 and the body must hold an uppercase letter or a digit:
    // base64 of any realistic `user:password` clears both easily, while the
    // long all-lowercase word that follows "Basic " in prose — "Basic
    // internationalization support" — clears neither.
    kind: "basic-auth",
    pattern: /\b(Basic\s+)(?=[A-Za-z0-9+/]*[A-Z0-9+/])[A-Za-z0-9+/]{20,}={0,2}/g,
    replace: (_m: string, prefix: string) => `${prefix}${REDACTED_TOKEN}`,
  },
  {
    // `curl -u user:password`, the form Bitbucket's API docs use. An app
    // password issued before the ATBB prefix has no shape of its own, and
    // here it sits behind no key the assignment rules would recognise, so
    // this flag is the only thing marking it as a credential.
    //
    // The password must be 8+ characters and hold a letter, which is what
    // separates a credential from `docker run -u 1000:1000`. The user is kept,
    // as in a URL — it is usually a service account name.
    kind: "user-password",
    pattern: /(^|\s)(-u|--user)([=\s]+)([^\s:=]{1,64}):((?!\[redacted:)(?=\S*[A-Za-z])\S{8,})/g,
    replace: (_m: string, lead: string, flag: string, sep: string, user: string) =>
      `${lead}${flag}${sep}${user}:${REDACTED_PASSWORD}`,
  },
  {
    // user:password@host in a URL. The user is kept — it is often a service
    // name — and only the password goes.
    kind: "url-password",
    pattern: /(\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:)([^/\s@]+)(@)/gi,
    replace: (_m: string, before: string, _pw: string, at: string) => `${before}${REDACTED_PASSWORD}${at}`,
  },

  {
    // key="value with spaces" — the whole quoted value goes. This rule must
    // come first: the unquoted rule below would otherwise stop at the opening
    // quote and redact only the first word of a quoted passphrase.
    kind: "assignment",
    pattern: new RegExp(
      `(${ASSIGNMENT_KEY}["']?\\s*[=:]\\s*)(["'])((?!\\[redacted:)(?:[^"'\\\\\\n]|\\\\.)*[A-Za-z](?:[^"'\\\\\\n]|\\\\.)*)\\2`,
      "gi",
    ),
    replace: (_m: string, head: string, quote: string) => `${head}${quote}${REDACTED_VALUE}${quote}`,
  },
  {
    // key=value, unquoted, running to the end of the line.
    //
    // Stopping at the first space left `PASSWORD=correct horse battery` almost
    // entirely in the clear — and worse, matched nothing at all, because the
    // first word was under the length floor. A passphrase may contain spaces,
    // so the value is the rest of the line (to a `;` or `,` separator).
    //
    // That does mean prose after a credential on the same line goes with it:
    // `token=abc12345 (expired)` loses the parenthetical. For a credential
    // scrubber that is the right side to err on — the alternative is leaving
    // half a secret on screen. Quoted values keep their exact bounds above,
    // and JSON, where values are always quoted, is unaffected.
    //
    // The first character is pinned to a non-space, non-quote on purpose:
    // `\s*` above would otherwise backtrack to empty and let the value start
    // at the space before an opening quote — matching a quoted value after
    // all, and undoing the rule above it.
    kind: "assignment",
    pattern: new RegExp(
      `(${ASSIGNMENT_KEY}["']?\\s*[=:]\\s*)((?!\\[redacted:)(?=[^\\n;,]*[A-Za-z])[^\\s"'\\n;,][^\\n;,]{7,})`,
      "gi",
    ),
    replace: (_m: string, head: string, value: string) => {
      // Trailing whitespace is not part of the value; keep the line's shape.
      const trailing = /\s*$/.exec(value)?.[0] ?? "";
      return `${head}${REDACTED_VALUE}${trailing}`;
    },
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
      // A kind may span several rules — `assignment` is the quoted and the
      // unquoted form — and this list is documented as naming each one once.
      if (!kinds.includes(rule.kind)) kinds.push(rule.kind);
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

/** Longest run of withheld lines before a `BEGIN` is judged not to be a key. */
const MAX_KEY_BLOCK_LINES = 512;

const KEY_BEGIN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const KEY_END = /-----END [A-Z ]*PRIVATE KEY-----/;

/**
 * A redactor for callers that only ever hold one line at a time.
 *
 * {@link redactSecrets} matches against a whole string, so a caller scrubbing
 * line by line — a streaming log writer, say — cannot catch a PEM private key:
 * its `BEGIN` and `END` markers sit on different lines, and neither line on its
 * own looks like anything. The body is base64, so no other rule fires either,
 * and the whole key lands on disk.
 *
 * This keeps the only state that needs. Between the two markers lines are
 * withheld, and on `END` the block is handed to {@link redactSecrets} whole —
 * so the output is what whole-string redaction would have produced, rather
 * than an approximation of it. Every other line is scrubbed and passed through.
 *
 * A `BEGIN` with no `END` is not a key: whole-string redaction leaves such text
 * alone, because the pattern needs both markers. After
 * {@link MAX_KEY_BLOCK_LINES} the withheld lines are released, scrubbed
 * individually, and {@link LineRedactor.flush} does the same at end of stream —
 * so a stray `BEGIN` can neither swallow the rest of the log nor drop it.
 */
export interface LineRedactor {
  /**
   * Scrub one line. Returns the lines to write — none while a key block is
   * open, and the whole redacted block when it closes.
   */
  push(line: string): string[];
  /** Release anything still withheld. Call once, at end of stream. */
  flush(): string[];
}

/** Create a {@link LineRedactor}. The state is per-stream, so use one per log. */
export function createLineRedactor(): LineRedactor {
  let held: string[] | null = null;

  const release = (): string[] => {
    const lines = held ?? [];
    held = null;
    return lines.map((line) => redactSecrets(line));
  };

  return {
    push(line: string): string[] {
      if (held === null) {
        // A key that opens and closes on one line needs no state at all.
        if (!KEY_BEGIN.test(line) || KEY_END.test(line)) return [redactSecrets(line)];
        held = [line];
        return [];
      }
      held.push(line);
      if (KEY_END.test(line)) {
        const block = held.join("\n");
        held = null;
        return redactSecrets(block).split("\n");
      }
      if (held.length > MAX_KEY_BLOCK_LINES) return release();
      return [];
    },
    flush: release,
  };
}
