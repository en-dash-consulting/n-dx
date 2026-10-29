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
 *    `AKIA…`, `xoxb-…`, `ATBB…`, `sk_live_…`, `SG.…`, `hvs.…`), JWTs,
 *    private-key blocks, webhook URLs, signed-URL query parameters,
 *    `Bearer`, `Token` and `Basic` headers, `Cookie` headers, `-u
 *    user:password` and `--token value` flags and URL userinfo. These need no
 *    key to be recognised.
 * 2. **Credential-shaped assignments** — `KEY=value`, `key: value` or
 *    `"key": "value"` where the key *ends* in a sensitive word (`token`,
 *    `secret`, `password`, `api_key`, `access_key`, …). The key is kept, the
 *    value replaced. The suffix rule, and the requirement that the value hold
 *    a letter, keep run-record fields such as `tokenUsage`, `totalTokens` or
 *    `tokenDiagnosticStatus` untouched.
 *
 * Every rule skips a span that an earlier rule (or an earlier pass) has
 * already replaced, so the output carries no nested markers and a second pass
 * over redacted text changes nothing.
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
 * printed bare. The one exception is an AWS secret key, which is matched bare
 * when the same text also carries an AWS access key id or an
 * `aws_secret…` key name — see the `aws-secret` rule.
 */

export const REDACTED_TOKEN = "[redacted:token]";
export const REDACTED_VALUE = "[redacted:value]";
export const REDACTED_KEY_BLOCK = "[redacted:private-key]";
export const REDACTED_PASSWORD = "[redacted:password]";

/** The opening of every marker this module writes. */
const MARKER_PREFIX = "[redacted:";

interface Rule {
  kind: string;
  pattern: RegExp;
  /**
   * The replacement. A function receives the match and its groups and may
   * return the match unchanged to decline — a declined match is not counted
   * as a redaction.
   */
  replace: string | ((...groups: string[]) => string);
  /**
   * Gate on the *original* text: the rule is skipped unless this returns
   * true. Used by a rule whose shape is only credential-like in context.
   */
  when?: (text: string) => boolean;
}

// The key half of an assignment: a name ending in a sensitive word, with or
// without a prefix, so both `password=` and `GITHUB_TOKEN=` match. Written
// once and shared by the two assignment rules, which must agree on what a
// key is.
//
// Words that are *not* here, and why:
// - `session` / `sessionid` — hench's run record carries `sessionId` (the
//   CLI session reused on resume) and `session`; redacting either would
//   break resume. `session_key` is matched through the `…key` branch.
// - a bare `pass` — Go's test runner prints `--- PASS: TestName`, so `pass`
//   needs a prefix (`DB_PASS`, `db-pass`) to count as a key.
const ASSIGNMENT_KEY =
  "\\b(?:" +
  "[A-Za-z0-9_.-]*?(?:token|secret|password|passwd|pwd|auth|cookie|signature|sig|dsn|api[_-]?key|apikey|credentials?" +
  "|(?:secret|access|encryption|signing|master|session|stripe|private)[_-]?key)" +
  "|[A-Za-z0-9_.-]+?pass" +
  ")\\b";

/** Keys that name a password: the value floor is lowered for these (a PIN). */
const PASSWORD_KEY = /(?:password|passwd|pass|pwd)$/i;

/** Values that are a language literal, not a credential. */
const LITERAL_VALUE = /^(?:null|true|false|none|undefined)$/i;

/**
 * Decide whether an assignment value is a credential worth replacing.
 *
 * @param head   The matched key plus separator (`GITHUB_TOKEN=`, `"api_key": `).
 * @param value  The value, without quotes or trailing whitespace.
 * @param quoted Whether the value was quoted; quoted values have exact bounds
 *               so no length floor is needed to tell them from prose.
 */
function isCredentialValue(head: string, value: string, quoted: boolean): boolean {
  // Already handled by an earlier rule or an earlier pass.
  if (value.includes(MARKER_PREFIX)) return false;
  if (value.length === 0 || LITERAL_VALUE.test(value)) return false;
  const key = /([A-Za-z0-9_.-]+)["']?\s*[=:]\s*$/.exec(head)?.[1] ?? "";
  // `env` prints the working directory as PWD=/path — a directory, not a
  // password. Only the exact shell variables are exempt, and only when the
  // value is a path; `pwd=` in a connection string is still redacted.
  if (/^(?:OLD)?PWD$/.test(key) && /^(?:[/~]|[A-Za-z]:[\\/])/.test(value)) return false;
  if (PASSWORD_KEY.test(key)) {
    // A password may be short and all-digit (a PIN); the key already says
    // what it is. Four characters keeps `password: no` style prose alone.
    return quoted || value.length >= 4;
  }
  // Other keys need a letter — `totalTokens: 12345678` is a counter — unless
  // the value is a long digit run, which is a secret, not a count.
  if (/^[0-9]{16,}$/.test(value)) return true;
  if (!/[A-Za-z]/.test(value)) return false;
  return quoted || value.length >= 8;
}

/** Cookie attributes that follow the pairs in a `Set-Cookie` header. */
const COOKIE_ATTRIBUTE = /^(?:path|domain|expires|max-age|samesite|secure|httponly|priority|partitioned|version|comment)$/i;

const RULES: readonly Rule[] = [
  {
    // PEM private keys and PGP private key blocks, whole.
    kind: "private-key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/g,
    replace: REDACTED_KEY_BLOCK,
  },
  {
    // Incoming webhook URLs: the path *is* the credential. The host is kept
    // so the record still says which service was called.
    //
    // gitleaks `slack-webhook-url`: `hooks.slack.com/(services|workflows|
    // triggers)/[A-Za-z0-9+/]{43,56}`; the floor here is lower, as with the
    // vendor prefixes below. Discord documents its webhook URL as
    // `discord.com/api/webhooks/<id>/<token>`.
    kind: "webhook",
    pattern: /(\bhooks\.slack\.com\/(?:services|workflows|triggers)\/|\bdiscord(?:app)?\.com\/api\/webhooks\/[0-9]+\/)(?!\[redacted:)[A-Za-z0-9+/_-]{20,}/g,
    replace: (_m: string, head: string) => `${head}${REDACTED_TOKEN}`,
  },
  {
    // Signed URLs: an Azure SAS `sig=`, an S3 presigned `X-Amz-Signature=`
    // and `X-Amz-Credential=`, a GCS `X-Goog-Signature=`. The query value is
    // the credential; the rest of the URL is kept.
    kind: "url-signature",
    pattern: /([?&](?:sig|signature|X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|X-Goog-Signature|X-Goog-Credential)=)(?!\[redacted:)[^&\s"'<>]+/gi,
    replace: (_m: string, head: string) => `${head}${REDACTED_TOKEN}`,
  },
  {
    // An AWS secret access key printed bare — `echo $AWS_SECRET_ACCESS_KEY`,
    // or a credentials file with the key on its own line. The shape (40
    // characters of base64) is also a content hash, so it is only matched
    // when the same text carries an access key id or an `aws_secret…` name:
    // trufflehog `pkg/detectors/aws` pairs `[A-Za-z0-9+/]{40}` with
    // `(AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}` the same way. Upper, lower and
    // digit are all required, which base64 of 30 random bytes always has.
    kind: "aws-secret",
    when: (text) => /(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}/.test(text) || /aws[_-]?secret/i.test(text),
    pattern: /(?<![A-Za-z0-9/+])(?=[A-Za-z0-9/+]*[A-Z])(?=[A-Za-z0-9/+]*[a-z])(?=[A-Za-z0-9/+]*[0-9])[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+=])/g,
    replace: REDACTED_TOKEN,
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
        // access token.
        //
        // Each body alphabet below is taken from a published detector
        // ruleset, cited on its line, rather than from memory. The earlier
        // classes were written without one and were too narrow in exactly the
        // way that matters for redaction: a body character outside the class
        // ends the match, and everything after it stays in the record in
        // plain text. A too-wide class only over-redacts.
        //
        // Length floors are deliberately *below* the published ones. A floor
        // that is too high misses a short credential entirely; one that is
        // too low costs an occasional over-redaction behind a four-character
        // prefix that does not occur in ordinary prose.

        // trufflehog `pkg/detectors/bitbucketapppassword`:
        // `ATBB[A-Za-z0-9_=.-]+`. Its own fixture `ATBBa9iO-tyg7u_op` carries
        // both `-` and `_`, neither of which the previous `[A-Za-z0-9]` class
        // admitted — so a real app password was redacted only up to its first
        // hyphen. No vendor-published length; the floor sits below the
        // shortest body in that ruleset's fixtures rather than being invented.
        "ATBB[A-Za-z0-9_=.-]{12,}",

        // gitleaks `atlassian-api-token` pins `ATATT3[A-Za-z0-9_\\-=]{186}`
        // (192 characters all told), and trufflehog `pkg/detectors/atlassian/v2`
        // pins `ATCTT3xFfG[A-Za-z0-9+/=_-]+=[A-Za-z0-9]{8}`. Both describe the
        // same shape: prefix, a base64 body, then `=` and 8 hex of CRC32. The
        // `+` and `/` come from trufflehog's class and its sample token; the
        // previous class had neither, so a body containing one was cut there.
        // The `=` and the checksum are inside the class, so the tail is
        // covered without anchoring on it — a token issued without one is
        // still matched.
        "AT(?:CT|AT)T[A-Za-z0-9+/=_-]{20,}",

        // Prefixed since Bitbucket Data Center 8 (GitGuardian's
        // `bitbucket_http_access_token_prefixed` detector). The body is plain
        // base64 — glsec's rule is `BBDC-[A-Za-z0-9+/=]{32,}` and its fixture
        // is `Ab+/` repeated — so `+`, `/` and `=` all belong in the class and
        // none of them were there before.
        "BBDC-[A-Za-z0-9+/=]{20,}",

        // gitleaks `stripe-access-token`:
        // `(sk|rk)_(test|live|prod)_[0-9a-zA-Z]{10,99}`.
        "(?:sk|rk)_(?:live|test|prod)_[A-Za-z0-9]{10,}",
        // gitleaks `sendgrid-api-token`:
        // `SG\\.[a-zA-Z0-9_-]{22}\\.[a-zA-Z0-9_-]{43}`.
        "SG\\.[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}",
        // gitleaks `vault-service-token` `hvs\\.[a-z0-9A-Z_-]{24,}` and
        // `vault-batch-token` `hvb\\.[a-z0-9A-Z_-]{24,}`.
        "hv[sb]\\.[A-Za-z0-9_-]{20,}",
        // gitleaks `shopify-access-token` and siblings: `shpat_`, `shpss_`,
        // `shpca_`, `shppa_`, each followed by 32 hex.
        "shp(?:at|ss|ca|pa)_[a-fA-F0-9]{32}",
        // gitleaks `twilio-api-key`: `SK[0-9a-fA-F]{32}`. Bounded on both
        // sides — the prefix is two letters, so a longer identifier that
        // happens to contain it must not match.
        "\\bSK[0-9a-fA-F]{32}\\b",
        // trufflehog `pkg/detectors/discordbottoken`:
        // `[MN][A-Za-z\\d]{23}\\.[\\w-]{6}\\.[\\w-]{27,}` — a base64 user id,
        // a timestamp and an HMAC, dot-separated.
        "[MN][A-Za-z0-9]{23}\\.[A-Za-z0-9_-]{6}\\.[A-Za-z0-9_-]{27,}",
        // gitleaks `azure-ad-client-secret`:
        // `[a-zA-Z0-9_~.]{3}\\dQ~[a-zA-Z0-9_~.-]{31,34}`, bounded on the left.
        "(?<![A-Za-z0-9_~.-])[A-Za-z0-9_~.]{3}[0-9]Q~[A-Za-z0-9_~.-]{31,34}",
        "eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}",
      ].join("|"),
      "g",
    ),
    replace: REDACTED_TOKEN,
  },
  {
    // `Bearer <token>`. Sixteen characters of token alphabet are enough on
    // their own. A shorter token — some gateways issue twelve — is accepted
    // from eight characters when it holds a digit, which is what separates
    // it from the word that follows "Bearer" in prose ("Bearer tokens are
    // sent in a header", "Bearer authentication").
    kind: "bearer",
    pattern: /\b(Bearer\s+)(?:[A-Za-z0-9._~+/=-]{16,}|(?=[A-Za-z._~+/=-]*[0-9])[A-Za-z0-9._~+/=-]{8,})/g,
    replace: (_m: string, prefix: string) => `${prefix}${REDACTED_TOKEN}`,
  },
  {
    // `Authorization: Token <key>` (Django REST framework, many APIs) and
    // `Authorization: ApiKey <key>` (Elasticsearch). "Token" is an ordinary
    // word, so the header name is required.
    kind: "token-header",
    pattern: /(\bAuthorization["']?\s*[:=]\s*["']?(?:Token|ApiKey)\s+)[A-Za-z0-9._~+/=-]{8,}/gi,
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
    // separates a credential from `docker run -u 1000:1000`. It must not
    // start with a slash either: `git push -u https://…` and
    // `diff -u C:\…` put a colon after the flag too, and what follows is a
    // URL or a path. The user is kept, as in a URL — it is usually a service
    // account name.
    kind: "user-password",
    pattern: /(^|\s)(-u|--user)([=\s]+)([^\s:=]{1,64}):((?!\[redacted:)(?![/\\])(?=\S*[A-Za-z])\S{8,})/g,
    replace: (_m: string, lead: string, flag: string, sep: string, user: string) =>
      `${lead}${flag}${sep}${user}:${REDACTED_PASSWORD}`,
  },
  {
    // A credential handed over on the command line: `--token <value>`,
    // `--password=<value>`. The flag must be followed directly by a space or
    // `=`, so `--token-file` and `--password-stdin` are not flags of this
    // kind, and `--no-auth` is not `--auth`.
    kind: "flag",
    pattern: /((?:^|\s)--(?:token|access-token|api-key|apikey|password|passwd|pwd|secret|client-secret|auth)[ =])(?!\[redacted:)\S{2,}/gi,
    replace: (_m: string, head: string) => `${head}${REDACTED_VALUE}`,
  },
  {
    // user:password@host in a URL. The user is kept — it is often a service
    // name — and only the password goes. A userinfo that an earlier rule has
    // already replaced (`https://[redacted:token]@github.com/…`) is left as
    // it is, rather than being wrapped in a second marker.
    kind: "url-password",
    pattern: /(\b[a-z][a-z0-9+.-]*:\/\/(?!\[redacted:)[^/\s:@]+:)([^/\s@]+)(@)/gi,
    replace: (_m: string, before: string, _pw: string, at: string) => `${before}${REDACTED_PASSWORD}${at}`,
  },
  {
    // `Cookie:` and `Set-Cookie:` headers. Each `name=value` pair loses its
    // value and keeps its name; the attributes that follow the pair in a
    // `Set-Cookie` (`Path=/`, `Max-Age=…`) are not cookies and are kept.
    kind: "cookie",
    pattern: /(\b(?:Set-)?Cookie["']?\s*:\s*["']?)([^\n]*)/gi,
    replace: (_m: string, head: string, body: string) =>
      head +
      body.replace(/([A-Za-z0-9_.-]+)=([^;\s"']*)/g, (pair: string, name: string, value: string) => {
        if (value.length === 0 || value.startsWith(MARKER_PREFIX) || COOKIE_ATTRIBUTE.test(name)) return pair;
        return `${name}=${REDACTED_VALUE}`;
      }),
  },
  {
    // key="value with spaces" — the whole quoted value goes. This rule must
    // come first: the unquoted rule below would otherwise stop at the opening
    // quote and redact only the first word of a quoted passphrase.
    kind: "assignment",
    pattern: new RegExp(`(${ASSIGNMENT_KEY}["']?\\s*[=:]\\s*)(["'])((?:[^"'\\\\\\n]|\\\\.)*)\\2`, "gi"),
    replace: (m: string, head: string, quote: string, value: string) =>
      isCredentialValue(head, value, true) ? `${head}${quote}${REDACTED_VALUE}${quote}` : m,
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
    // all, and undoing the rule above it. It must not open a bracket either:
    // `"auth": {` begins an object, and taking it would break the JSON.
    kind: "assignment",
    pattern: new RegExp(`(${ASSIGNMENT_KEY}["']?\\s*[=:]\\s*)([^\\s"'\\n;,{\\[][^\\n;,]*)`, "gi"),
    replace: (m: string, head: string, raw: string) => {
      // Trailing whitespace is not part of the value; keep the line's shape.
      const trailing = /\s*$/.exec(raw)?.[0] ?? "";
      const value = raw.slice(0, raw.length - trailing.length);
      return isCredentialValue(head, value, false) ? `${head}${REDACTED_VALUE}${trailing}` : m;
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
    if (rule.when && !rule.when(text)) continue;
    let fired = 0;
    out = out.replace(rule.pattern, (...args: unknown[]) => {
      const match = args[0] as string;
      const groups = args.slice(0, -2) as string[];
      const replacement = typeof rule.replace === "string" ? rule.replace : rule.replace(...groups);
      // A rule may look at a match and decline it; that is not a redaction.
      if (replacement !== match) fired += 1;
      return replacement;
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

const KEY_BEGIN = /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/;
const KEY_END = /-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/;

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
