/**
 * Credential redaction for literals copied from source into analysis output.
 *
 * Analysis copies strings out of the code it reads: outbound targets, config
 * keys, expressions as written, route paths, findings. A literal URL or
 * connection string in that code may carry a credential, and no output file
 * may. Every artifact sourcevision writes passes through here: JSON through
 * `toCanonicalJSON` (`util/sort.ts`), CONTEXT.md and llms.txt through their
 * generators. It is one rule set for every language, so no pack has to get
 * it right on its own.
 *
 * Three shapes are rewritten, wherever they appear in a string:
 *
 * - **URL userinfo.** `scheme://user:password@host` and `scheme://:pw@host`
 *   lose everything before the last `@` of the authority. A user alone goes
 *   too: a token is often sent as the user (`https://<token>@host`).
 * - **Secret-shaped query parameters** (`?token=…`, `&api_key=…`): the name
 *   is kept and the value becomes {@link REDACTED}.
 * - **Key=value connection strings** (`mysql:host=h;password=…`,
 *   `Server=h;Password=…`, `jdbc:…;password=…`): the same, for each
 *   secret-shaped key.
 *
 * Scheme, host, port, path and every other parameter are kept. Strings are
 * scanned in whitespace- and quote-delimited tokens with bounded patterns, so
 * the cost is linear in the text. Redaction is idempotent.
 */

/** What a secret value is replaced with. */
export const REDACTED = "REDACTED";

/** Secret words matched at the end of a parameter name, separators and case ignored. */
const SECRET_SUFFIXES = [
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "accesskey",
  "signature",
  "credential",
  "credentials",
] as const;

/** Short secret words, matched only as a name's whole last word (`db_pass`, `apiKey`, not `bypass`). */
const SECRET_WORDS = new Set(["pwd", "pass", "key", "auth", "sig"]);

/**
 * Whether a query or connection-string parameter name names a secret:
 * `password`, `DB_PASS`, `apiKey`, `x-api-key`, `access_token`, `sig`. Not
 * `user`, `host`, `bypass` or `monkey`.
 */
export function isSecretName(name: string): boolean {
  const words = name
    .trim()
    .split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])/)
    .filter((w) => w.length > 0)
    .map((w) => w.toLowerCase());
  if (words.length === 0) return false;
  const joined = words.join("");
  if (SECRET_SUFFIXES.some((suffix) => joined.endsWith(suffix))) return true;
  return SECRET_WORDS.has(words[words.length - 1]);
}

/** A scheme and `://`; the authority runs to the first `/`, `?` or `#`. */
const URL_AUTHORITY = /([A-Za-z][A-Za-z0-9+.-]{0,31}:\/\/)([^/?#]*)/g;

/** One parameter: a separator (or the token's start), a name without separators, `=`, the value. */
const PARAMETER = /(^|[?&;:])([^?&;:=/#]{1,64})=([^?&;#]*)/g;

/** Text with nothing to redact: no `@` and no `=`. */
const NOTHING_TO_REDACT = /^[^@=]*$/;

/** A run of text that holds no whitespace, quote or angle bracket. */
const TOKEN = /[^\s"'`<>]+/g;

function redactToken(token: string): string {
  if (NOTHING_TO_REDACT.test(token)) return token;
  const withoutUserinfo = token.replace(URL_AUTHORITY, (_m, scheme: string, authority: string) =>
    scheme + authority.slice(authority.lastIndexOf("@") + 1),
  );
  return withoutUserinfo.replace(PARAMETER, (match, separator: string, name: string, value: string) =>
    value.length > 0 && isSecretName(name) ? `${separator}${name}=${REDACTED}` : match,
  );
}

/** `text` with every URL userinfo and secret-shaped parameter value removed. */
export function redactLiterals(text: string): string {
  if (NOTHING_TO_REDACT.test(text)) return text;
  return text.replace(TOKEN, redactToken);
}

/**
 * `value` with {@link redactLiterals} applied to every string in it, object
 * keys included. Objects and arrays with nothing redacted are returned as
 * they are, so a clean artifact is not copied.
 */
export function redactLiteralsDeep<T>(value: T): T {
  if (typeof value === "string") return redactLiterals(value) as T;
  if (Array.isArray(value)) {
    let out: unknown[] | undefined;
    value.forEach((item, i) => {
      const redacted = redactLiteralsDeep(item);
      if (redacted !== item) (out ??= [...value])[i] = redacted;
    });
    return (out ?? value) as T;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    let changed = false;
    const redacted = entries.map(([key, item]) => {
      const k = redactLiterals(key);
      const v = redactLiteralsDeep(item);
      if (k !== key || v !== item) changed = true;
      return [k, v] as const;
    });
    return (changed ? Object.fromEntries(redacted) : value) as T;
  }
  return value;
}
