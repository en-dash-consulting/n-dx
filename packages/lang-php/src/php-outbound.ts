/**
 * Outbound-call rules over the PHP pack: HTTP, SOAP, databases, caches and
 * environment reads.
 *
 * A framework pack (lang-runtime's `FrameworkPack`): its query
 * (`queries/php-outbound/outbound.scm`) runs in the PHP parse only when
 * outbound calls are wanted, and these rules read its captures with the PHP
 * queries' `imports`, `guards`, `definitions` and `references`. Rules (keys of
 * {@link PROVENANCE}):
 *
 * - `curl`: `curl_init(url)`, `curl_setopt($ch, CURLOPT_URL, url)` and
 *   `curl_setopt_array($ch, [CURLOPT_URL => url, …])`; client `curl`.
 * - `streams`: `file_get_contents`, `fopen`, `file` and `get_headers` whose
 *   first argument is an `http://` or `https://` URL (a literal, a constant,
 *   a variable or a concatenation starting with one); client the function.
 * - `fsockopen`: `fsockopen(hostname, …)`; client `fsockopen`.
 * - `soap`: `new SoapClient(wsdl, …)`, or the `location` option when the
 *   WSDL is `null`; client `SoapClient`.
 * - `guzzle`: `new GuzzleHttp\Client([...])` with a `base_uri` (Guzzle 6+)
 *   or `base_url` (Guzzle 5) option, and `get`, `post`, `put`, `patch`,
 *   `delete`, `head`, `options` (uri first) and `request` (uri second), and
 *   their `…Async` forms, on a receiver bound to one; client `guzzle`.
 * - `env`: `getenv('X')` and `$_SERVER['X']` unless `X` is a request key
 *   ({@link isRequestKey}), and `$_ENV['X']`: kind `env`, target `X`, target source
 *   `env`; clients `getenv`, `$_ENV`, `$_SERVER`. An assignment to or `unset`
 *   of one is a write and not reported; a `$_SERVER` key that is not a literal
 *   is not reported, a `getenv`/`$_ENV` one is, with an unknown target.
 * - `database` (kind `database`; client the PHP extension): `mysql_connect`
 *   and `mysql_pconnect` (`mysql`), `mysqli_connect` and `new mysqli`
 *   (`mysqli`, the persistent prefix `p:` dropped, the port appended), `new PDO(dsn)` (`pdo_<driver>` from the
 *   DSN's prefix, `pdo` when unknown), `pg_connect` and `pg_pconnect`
 *   (`pgsql`), `oci_connect`, `oci_pconnect` and `oci_new_connect` (`oci8`),
 *   `sqlsrv_connect` (`sqlsrv`), `odbc_connect` and `odbc_pconnect`
 *   (`odbc`), and Doctrine DBAL's `DriverManager::getConnection([...])`
 *   (`doctrine-dbal`; its `url`, else `host` and `port`, else `path`).
 *   A DSN or connection string (`key=value` separated by `;` or spaces)
 *   gives its `host`/`server`/`hostaddr` and `port`, else its
 *   `unix_socket`, else its `dbname`; SQLite gives its path; anything else
 *   is the value as written ({@link connectionTarget}).
 * - `cache` (kind `cache`): `connect`, `pconnect` and `addServer` on a
 *   receiver bound to `new Memcache` (`memcache`), `addServer` on one bound
 *   to `new Memcached` (`memcached`), `connect`, `pconnect`, `open` and
 *   `popen` on one bound to `new Redis` (`redis`), each host with its port;
 *   `new Predis\Client(parameters)` (`predis`; a URI, or `host` and `port`,
 *   or `path`).
 *
 * A database or cache target never keeps a URI's user and password
 * (`mysql://u:p@db/app` is `mysql://db/app`).
 *
 * Targets: a value computable as an include path is (literals, `.`,
 * constants the repository defines once, variables assigned one in the same
 * scope; `php-includes.ts`) is `literal`; an environment read as above is
 * `env` with its key; `$config['key']` (a variable or property named
 * {@link CONFIG_NAMES}, keys joined with `.`) is `config`; a concatenation or
 * interpolated string takes its computable leading text as `literal`, else
 * the source of its first part (a database host written as a whole value,
 * not a connection string, never takes partial text: it is the source of
 * its first part that is not computable, never `literal`); a variable takes the target of its last
 * plain assignment before the call in its scope; anything else is `unknown`
 * with target `""`.
 *
 * Confidence is `certain`: the functions are PHP's own (called unqualified
 * or with a leading `\`), the classes are qualified as PHP does, and a
 * Guzzle, Memcache, Memcached or Redis method counts only on a receiver every
 * assignment in its scope (the function body for a variable, the file for a
 * property) binds to a client of that class. `mail()` is not an outbound
 * call.
 *
 * @module lang-php/php-outbound
 */

import { join } from "node:path";
import type { FactKind, FileFacts, OutboundCallFact, SourcePosition } from "@n-dx/lang-kit";
import { innermostEach, type Capture, type FrameworkFacts, type FrameworkPack, type PackSourceFile, type RuleProvenance } from "@n-dx/lang-runtime";
import { PHP_PACKAGE } from "./package-paths.js";
import { before, readAssignments, scopeAt, type Assignment } from "./php-assignments.js";
import { concatenationOperands, evaluatePath, interpolatedEnds, isPlainValue, repositoryConstants, type ConstantLookup } from "./php-includes.js";
import { readPhpReferences } from "./php-resolver.js";

export const OUTBOUND_QUERY = "outbound";

// ── Provenance ──────────────────────────────────────────────────────────────

const rule = (verifiedAgainst: readonly string[], source: string): RuleProvenance => ({ verifiedAgainst, verifiedOn: "2026-11-16", source });

const PROVENANCE: Readonly<Record<string, RuleProvenance>> = {
  [OUTBOUND_QUERY]: rule(["tree-sitter-php@0.25.1"], "https://github.com/tree-sitter/tree-sitter-php/blob/v0.25.1/php/src/node-types.json"),
  // curl_init(?string $url), curl_setopt($handle, CURLOPT_URL, $value), curl_setopt_array($handle, array $options).
  curl: rule(["PHP manual"], "https://www.php.net/manual/en/function.curl-setopt.php"),
  // The http:// and https:// wrappers open URLs through file_get_contents, fopen, file and get_headers.
  streams: rule(["PHP manual"], "https://www.php.net/manual/en/wrappers.http.php"),
  // fsockopen(string $hostname, int $port = -1, …).
  fsockopen: rule(["PHP manual"], "https://www.php.net/manual/en/function.fsockopen.php"),
  // SoapClient::__construct(?string $wsdl, array $options = []); without a WSDL, `location` is the service URL.
  soap: rule(["PHP manual"], "https://www.php.net/manual/en/soapclient.construct.php"),
  // Client options `base_uri`; request methods take the URI first, `request(method, uri)` second.
  guzzle: rule(["Guzzle 7", "Guzzle 5"], "https://docs.guzzlephp.org/en/stable/quickstart.html"),
  // getenv(?string $name), $_ENV; $_SERVER's request indices are listed in the manual.
  env: rule(["PHP manual"], "https://www.php.net/manual/en/reserved.variables.server.php"),
  // mysql_connect(?string $server = null, …): "hostname:port" or ":/path/to/socket".
  mysql: rule(["PHP manual"], "https://www.php.net/manual/en/function.mysql-connect.php"),
  // mysqli_connect / mysqli::__construct(?string $hostname, …, ?string $database, ?int $port, …).
  mysqli: rule(["PHP manual"], "https://www.php.net/manual/en/mysqli.construct.php"),
  // PDO::__construct(string $dsn, …); the DSN's prefix names the driver.
  pdo: rule(["PHP manual"], "https://www.php.net/manual/en/pdo.drivers.php"),
  // pg_connect(string $connection_string, …): "host=… port=… dbname=…".
  pgsql: rule(["PHP manual"], "https://www.php.net/manual/en/function.pg-connect.php"),
  // oci_connect(string $username, string $password, ?string $connection_string, …).
  oci8: rule(["PHP manual"], "https://www.php.net/manual/en/function.oci-connect.php"),
  // sqlsrv_connect(string $serverName, array $connectionInfo = []).
  sqlsrv: rule(["PHP manual"], "https://www.php.net/manual/en/function.sqlsrv-connect.php"),
  // odbc_connect(string $dsn, …): a DSN name or a "Driver=…;Server=…" string.
  odbc: rule(["PHP manual"], "https://www.php.net/manual/en/function.odbc-connect.php"),
  // DriverManager::getConnection(array $params, …): url, host, port, path.
  dbal: rule(["Doctrine DBAL 2", "Doctrine DBAL 3"], "https://www.doctrine-project.org/projects/doctrine-dbal/en/current/reference/configuration.html"),
  // Memcache::connect/pconnect/addServer(string $host, int $port, …).
  memcache: rule(["PHP manual"], "https://www.php.net/manual/en/memcache.addserver.php"),
  // Memcached::addServer(string $host, int $port, int $weight = 0).
  memcached: rule(["PHP manual"], "https://www.php.net/manual/en/memcached.addserver.php"),
  // Redis::connect/pconnect (aliases open/popen)(string $host, int $port = 6379, …).
  redis: rule(["phpredis 5", "phpredis 6"], "https://github.com/phpredis/phpredis#connect-open"),
  // new Predis\Client($parameters): a URI string or an array with scheme, host, port, path.
  predis: rule(["Predis 1", "Predis 2"], "https://github.com/predis/predis#connecting-to-redis"),
};

// ── Request keys ────────────────────────────────────────────────────────────

/** The `$_SERVER` indices the PHP manual documents, which describe the request or the script rather than the environment. */
const REQUEST_KEYS: ReadonlySet<string> = new Set([
  "PHP_SELF", "argv", "argc", "GATEWAY_INTERFACE", "SERVER_ADDR", "SERVER_NAME", "SERVER_SOFTWARE", "SERVER_PROTOCOL",
  "QUERY_STRING", "DOCUMENT_ROOT", "HTTPS", "SERVER_ADMIN", "SERVER_PORT", "SERVER_SIGNATURE", "PATH_TRANSLATED",
  "AUTH_TYPE", "PATH_INFO", "ORIG_PATH_INFO",
  // CGI request meta-variables (RFC 3875 §4.1).
  "CONTENT_TYPE", "CONTENT_LENGTH",
]);

/**
 * Prefixes of request indices: `HTTP_*` headers, `REQUEST_*`, `REMOTE_*`, `SCRIPT_*`, `REDIRECT_*`, `PHP_AUTH_*`,
 * and mod_ssl's per-connection `SSL_*` (https://httpd.apache.org/docs/2.4/mod/mod_ssl.html#envvars).
 */
const REQUEST_PREFIXES = ["HTTP_", "REQUEST_", "REMOTE_", "SCRIPT_", "REDIRECT_", "PHP_AUTH_", "SSL_"] as const;

/** OpenSSL's own environment variables, which mod_ssl does not set (https://docs.openssl.org/master/man7/openssl-env/). */
const OPENSSL_ENV: ReadonlySet<string> = new Set(["SSL_CERT_FILE", "SSL_CERT_DIR"]);

/** Whether a `$_SERVER` or `getenv` key describes the request or the script, not the environment. */
export const isRequestKey = (key: string): boolean =>
  REQUEST_KEYS.has(key) || (!OPENSSL_ENV.has(key) && REQUEST_PREFIXES.some((p) => key.startsWith(p)));

// ── Targets ─────────────────────────────────────────────────────────────────

type Target = Pick<OutboundCallFact, "target" | "targetSource">;

const UNKNOWN: Target = { target: "", targetSource: "unknown" };

/** How deep a target is followed through variables and first parts. */
const MAX_DEPTH = 8;

/** The names of a configuration array or property, compared in lowercase. */
export const CONFIG_NAMES: ReadonlySet<string> = new Set(["config", "conf", "cfg", "configuration", "settings", "setting", "options", "params", "parameters"]);

const KEY = String.raw`\s*\[\s*(?:'[^'\\]*'|"[^"\\$]*"|[A-Za-z_]\w*)\s*\]`;
/** `$config['a']['b']`, `$this->config['a']`, `self::$config['a']`. */
const CONFIG = new RegExp(String.raw`^(?:\$[A-Za-z_]\w*(?:\s*(?:->|\?->)\s*[A-Za-z_]\w*)*|(?:\\?[A-Za-z_][\w\\]*)::\$[A-Za-z_]\w*)((?:${KEY})+)$`);
const KEYS = /\[\s*(?:'([^'\\]*)'|"([^"\\$]*)"|([A-Za-z_]\w*))\s*\]/g;
/** `$_ENV['X']`, `$_SERVER["X"]`, `$_SERVER[X]` (inside a string). */
const SUPERGLOBAL = /^\$_(ENV|SERVER)\s*\[\s*(?:'([^'\\]*)'|"([^"\\$]*)"|([A-Za-z_]\w*))\s*\]$/;
/** `$_ENV[…]` or `$_SERVER[…]` with a key that is not a literal. */
const SUPERGLOBAL_ANY = /^\$_(ENV|SERVER)\s*\[/;
const GETENV = /^\\?getenv\s*\(\s*(?:'([^'\\]*)'|"([^"\\$]*)")\s*(?:,[^)]*)?\)$/i;
const VARIABLE = /^\$([A-Za-z_]\w*)$/;
/** A leading literal that is only a scheme (`ssl://`, `https://`) names no target. */
const SCHEME_ONLY = /^[A-Za-z][\w+.-]*:\/\/$/;

/** The keys of a subscript chain, joined with `.`. */
const keysOf = (subscripts: string): string => [...subscripts.matchAll(KEYS)].map((m) => m[1] ?? m[2] ?? m[3]).join(".");

/**
 * What an environment read names: its key, `""` when the key is not a literal; undefined for a request key of
 * `$_SERVER` or `getenv` (which returns the request's meta-variables under CGI and Apache:
 * https://www.php.net/manual/en/function.getenv.php) or anything else. `$_ENV` keeps every key.
 */
export function envKey(text: string): string | undefined {
  const t = text.trim();
  const getenv = GETENV.exec(t);
  if (getenv) {
    const key = getenv[1] ?? getenv[2]!;
    return isRequestKey(key) ? undefined : key;
  }
  const read = SUPERGLOBAL.exec(t);
  if (read) {
    const key = read[2] ?? read[3] ?? read[4]!;
    return read[1] === "SERVER" && isRequestKey(key) ? undefined : key;
  }
  if (/^\\?getenv\s*\(/i.test(t) || /^\$_ENV\s*\[/.test(t)) return "";
  return undefined;
}

// ── Connection strings ──────────────────────────────────────────────────────

/** `dsn`: a PDO DSN (`driver:…`); `pairs`: a `pg_connect` or ODBC string; `plain`: the value is the target. */
export type ConnectionForm = "dsn" | "pairs" | "plain";

/** A connection's target, and the PDO driver its DSN names. */
export interface Connection {
  readonly target: Target;
  readonly driver?: string;
}

/** A connection string that stops right after a host key (`mysql:host=`), the host coming next. */
const OPEN_HOST_KEY = /(?:^|[;:\s])(?:host|server|hostaddr)\s*=\s*$/i;

/** `user:password@` after a URI's scheme. */
const CREDENTIALS = /^([A-Za-z][\w+.-]*:\/\/)[^@/]*@/;

/** A URI without its user and password. */
export const withoutCredentials = (target: string): string => target.replace(CREDENTIALS, "$1");

/** `host:port`, unless the host already names a port or is a socket path. */
function joinPort(host: string, port: string): string {
  if (/:\d+$/.test(host) || host.startsWith("/") || /^unix:/i.test(host)) return host;
  return `${host}:${port}`;
}

/** A value without the matching quotes around it; quotes around a line break stay. */
function unquoteValue(value: string): string {
  const quote = value[0];
  const wrapped = value.length >= 2 && (quote === "'" || quote === '"') && value[value.length - 1] === quote;
  return wrapped && !/[\n\r\u2028\u2029]/.test(value) ? value.slice(1, -1) : value;
}

const isSpace = (c: string): boolean => /\s/.test(c);
const isKeyStart = (c: string): boolean => /[A-Za-z_]/.test(c);
/** A key's characters after its first: word characters and spaces. */
const isKeyPart = (c: string): boolean => /[\w ]/.test(c);

/**
 * `key=value` pairs separated by `;` or whitespace, keys in lowercase, the
 * first of a repeated key kept, quotes around a value dropped. A key is a
 * letter or `_` then word characters and spaces (`Data Source=x`); white
 * space other than a space breaks it. A value is quoted, or runs to a `;` or
 * white space.
 *
 * A linear scan: the regex it replaces,
 * `/([A-Za-z_][\w ]*?)\s*=\s*('[^']*'|"[^"]*"|[^;\s]*)/g`, retried every
 * letter of a long run with no `=`, quadratic on repository input. It finds
 * the same pairs.
 */
export function connectionKeyValues(text: string): Map<string, string> {
  const pairs = new Map<string, string>();
  // An unclosed quote has no closing quote at any later place either.
  const unclosed = { "'": false, '"': false };
  let i = 0;
  while (i < text.length) {
    if (!isKeyStart(text[i]!)) {
      i += 1;
      continue;
    }
    // The run of key characters and white space from here; the `=` must end it.
    let end = i + 1;
    let lastWord = i;
    let lastBreak = -1;
    let breakInKey = -1;
    while (end < text.length && (isKeyPart(text[end]!) || isSpace(text[end]!))) {
      if (!isSpace(text[end]!)) [lastWord, breakInKey] = [end, lastBreak];
      else if (text[end] !== " ") lastBreak = end;
      end += 1;
    }
    // Any key starting before the run's end would need this `=`, so none can when it is missing.
    let start = i;
    if (breakInKey >= 0) {
      // White space other than a space breaks a key: it starts at the first letter or `_` after the last break.
      start = breakInKey + 1;
      while (start <= lastWord && !isKeyStart(text[start]!)) start += 1;
    }
    if (text[end] !== "=" || start > lastWord) {
      i = end + 1;
      continue;
    }
    const key = text.slice(start, lastWord + 1).toLowerCase();
    let v = end + 1;
    while (v < text.length && isSpace(text[v]!)) v += 1;
    let valueEnd = -1;
    const quote = text[v];
    if ((quote === "'" || quote === '"') && !unclosed[quote]) {
      const close = text.indexOf(quote, v + 1);
      if (close < 0) unclosed[quote] = true;
      else valueEnd = close + 1;
    }
    if (valueEnd < 0) {
      valueEnd = v;
      while (valueEnd < text.length && text[valueEnd] !== ";" && !isSpace(text[valueEnd]!)) valueEnd += 1;
    }
    if (!pairs.has(key)) pairs.set(key, unquoteValue(text.slice(v, valueEnd)));
    i = valueEnd;
  }
  return pairs;
}

/** A literal target without a URI's user and password. */
const credentialFree = (target: Target): Target => (target.targetSource === "literal" ? { ...target, target: withoutCredentials(target.target) } : target);

const literal = (target: string): Target => (target === "" ? UNKNOWN : { target: withoutCredentials(target), targetSource: "literal" });

/**
 * The target a computed DSN or connection string names: its host
 * (`host`, `server`, `hostaddr`) with its `port`, else its `unix_socket`,
 * else its `dbname`; an SQLite DSN's path; a string with no `key=value`
 * pairs as written.
 */
export function connectionTarget(value: string, form: ConnectionForm): Connection {
  const text = value.trim();
  if (form === "plain") return { target: literal(text) };
  let rest = text;
  let driver: string | undefined;
  if (form === "dsn") {
    const prefix = /^([A-Za-z][\w]*):/.exec(text);
    if (!prefix) return { target: UNKNOWN };
    driver = prefix[1]!.toLowerCase();
    rest = text.slice(prefix[0].length);
    if (driver === "sqlite" || driver === "sqlite2") return { target: literal(rest), driver };
    if (driver === "uri") return { target: UNKNOWN, driver };
  }
  const withDriver = (target: Target): Connection => (driver === undefined ? { target } : { target, driver });
  if (!rest.includes("=")) return withDriver(literal(rest));
  const pairs = connectionKeyValues(rest);
  const host = pairs.get("host") ?? pairs.get("server") ?? pairs.get("hostaddr");
  const port = pairs.get("port");
  if (host) return withDriver(literal(port && /^\d+$/.test(port) ? joinPort(host, port) : host));
  return withDriver(literal(pairs.get("unix_socket") ?? pairs.get("dbname") ?? ""));
}

/**
 * The PDO extension for a DSN's driver prefix (https://www.php.net/manual/en/pdo.drivers.php); `mssql:` and `sybase:` are PDO_DBLIB.
 * A Map, since a key is text from the repository (`constructor:`).
 */
const PDO_DRIVERS: ReadonlyMap<string, string> = new Map(
  Object.entries({
    cubrid: "pdo_cubrid", dblib: "pdo_dblib", mssql: "pdo_dblib", sybase: "pdo_dblib", firebird: "pdo_firebird", ibm: "pdo_ibm",
    informix: "pdo_informix", mysql: "pdo_mysql", oci: "pdo_oci", odbc: "pdo_odbc", pgsql: "pdo_pgsql", sqlite: "pdo_sqlite",
    sqlite2: "pdo_sqlite", sqlsrv: "pdo_sqlsrv",
  }),
);

/** Reads targets in one file. */
class TargetReader {
  private readonly assignments: Array<Assignment & { readonly scope: Capture | undefined }>;
  private readonly memo = new Map<string, string | undefined>();

  constructor(
    private readonly file: PackSourceFile,
    private readonly constant: ConstantLookup,
  ) {
    this.assignments = readAssignments(file).map((a) => ({ ...a, scope: scopeAt(file, a.start) }));
  }

  /** Where an argument written at `at` points. */
  of(text: string, at: SourcePosition, depth = 0): Target {
    const t = text.trim();
    if (depth > MAX_DEPTH || t === "") return UNKNOWN;
    const value = this.evaluate(t, at, depth);
    if (value !== undefined) return value !== "" && isPlainValue(value) ? { target: value, targetSource: "literal" } : UNKNOWN;
    const key = envKey(t);
    if (key !== undefined) return key === "" ? UNKNOWN : { target: key, targetSource: "env" };
    const config = configSubscript(t);
    if (config && CONFIG_NAMES.has(config.array)) return { target: config.key, targetSource: "config" };
    const variable = VARIABLE.exec(t);
    if (variable) {
      const assigned = this.lastAssignment(variable[1]!, at);
      return assigned?.value === undefined ? UNKNOWN : this.of(assigned.value, assigned.start, depth + 1);
    }
    const operands = concatenationOperands(t);
    if (operands === undefined) return UNKNOWN;
    let prefix = "";
    for (const operand of operands) {
      const part = this.evaluate(operand, at, depth);
      if (part === undefined || !isPlainValue(part)) {
        prefix += interpolatedEnds(operand)?.head ?? "";
        if (prefix !== "" && !SCHEME_ONLY.test(prefix)) return { target: prefix, targetSource: "literal" };
        return operands.length > 1 ? this.of(operand, at, depth + 1) : UNKNOWN;
      }
      prefix += part;
    }
    return UNKNOWN;
  }

  /**
   * Where a DSN or connection string written at `at` points: the parsed
   * value when computable; else, built by concatenation, the target of the
   * part that fills its open host key (`'mysql:host=' . getenv('DB_HOST')`);
   * else the target of the argument as a whole (env, config, unknown).
   */
  connection(text: string, at: SourcePosition, form: ConnectionForm, depth = 0): Connection {
    const t = text.trim();
    if (depth > MAX_DEPTH || t === "") return { target: UNKNOWN };
    const whole = this.evaluate(t, at, depth);
    if (whole !== undefined) return connectionTarget(whole, form);
    const variable = VARIABLE.exec(t);
    if (variable) {
      const assigned = this.lastAssignment(variable[1]!, at);
      return assigned?.value === undefined ? { target: UNKNOWN } : this.connection(assigned.value, assigned.start, form, depth + 1);
    }
    const operands = concatenationOperands(t);
    if (operands === undefined || (operands.length === 1 && interpolatedEnds(t) === undefined)) {
      const target = this.of(t, at, depth);
      return { target: target.targetSource === "literal" ? UNKNOWN : target };
    }
    let written = "";
    for (const operand of operands) {
      const part = this.evaluate(operand, at, depth);
      if (part !== undefined) {
        written += part;
        continue;
      }
      const ends = interpolatedEnds(operand);
      written += ends?.head ?? "";
      if (form === "plain") {
        // The value is the target: its computable part alone is not one (`'p:' . $server`).
        const rest = ends === undefined ? this.of(operand, at, depth + 1) : UNKNOWN;
        return { target: rest.targetSource === "literal" ? UNKNOWN : rest };
      }
      const parsed = connectionTarget(written, form);
      if (parsed.target.targetSource !== "unknown" || !OPEN_HOST_KEY.test(written)) return parsed;
      const filled = ends === undefined ? this.of(operand, at, depth + 1) : UNKNOWN;
      return { ...parsed, target: filled.targetSource === "literal" ? UNKNOWN : filled };
    }
    return connectionTarget(written, form);
  }

  /** `host` joined with the port written at `at` when both are literal. */
  withPort(host: Target, port: Capture | undefined, at: SourcePosition): Target {
    const text = argumentText(port);
    if (host.targetSource !== "literal" || text === undefined) return host;
    // An integer literal, or a constant or variable holding a numeric string.
    const value = /^\d+$/.test(text) ? text : this.of(text, at).target;
    return /^\d+$/.test(value) ? { ...host, target: joinPort(host.target, value) } : host;
  }

  /** The value of `text`, with the repository's constants and the variables assigned before `at` in its scope. */
  private evaluate(text: string, at: SourcePosition, depth: number): string | undefined {
    return evaluatePath(text, this.file.path, this.constant, (name) => this.variable(name, at, depth));
  }

  /**
   * What a variable holds at `at`: its last plain assignment before it in its
   * scope, then each `.=` appending; undefined when not computable. Memoized,
   * and earlier assignments are never evaluated, so a variable rebuilt from
   * itself line after line (`$u = $u . '&a=1';`) costs one evaluation per line,
   * not one per path through them.
   */
  private variable(name: string, at: SourcePosition, depth: number): string | undefined {
    if (depth >= MAX_DEPTH) return undefined;
    const key = `${name}@${at.line}:${at.column}#${depth}`;
    if (this.memo.has(key)) return this.memo.get(key);
    const scope = scopeAt(this.file, at);
    const relevant: Array<Assignment & { readonly scope: Capture | undefined }> = [];
    for (const a of this.assignments) {
      if (!before(a.start, at)) break;
      if (a.name !== name || a.scope !== scope) continue;
      if (a.operator === undefined) relevant.length = 0;
      relevant.push(a);
    }
    let value: string | undefined;
    for (const a of relevant) {
      const assigned = a.value === undefined ? undefined : this.evaluate(a.value, a.start, depth + 1);
      if (a.operator === undefined) value = assigned;
      else value = a.operator === ".=" && value !== undefined && assigned !== undefined ? value + assigned : undefined;
      if (value === undefined) break;
    }
    this.memo.set(key, value);
    return value;
  }

  /** The last plain `=` assignment of a variable before `at` in its scope; undefined after a later assignment that is not one. */
  private lastAssignment(name: string, at: SourcePosition): Assignment | undefined {
    const scope = scopeAt(this.file, at);
    let found: Assignment | undefined;
    for (const a of this.assignments) {
      if (!before(a.start, at)) break;
      if (a.name !== name || a.scope !== scope) continue;
      if (a.operator === undefined) found = a.value === undefined ? undefined : a;
      else if (a.operator !== ".=") found = undefined;
    }
    return found;
  }
}

/** The last name of a configuration subscript's array: `config` in `$this->config['a']`. */
function configName(text: string): string {
  const base = text.slice(0, text.indexOf("["));
  return /(\w+)\s*$/.exec(base)![1]!.toLowerCase();
}

/**
 * A subscript read with literal keys: its array's last name in lowercase
 * (`config` in `$this->config['a']`) and its keys joined with `.` (`a.b` for
 * `['a']['b']`); undefined for any other text. Whether the array holds
 * configuration is the caller's call ({@link CONFIG_NAMES}).
 */
export function configSubscript(text: string): { readonly array: string; readonly key: string } | undefined {
  const t = text.trim();
  const m = CONFIG.exec(t);
  return m ? { array: configName(t), key: keysOf(m[1]!) } : undefined;
}

// ── Calls ───────────────────────────────────────────────────────────────────

/** One call the query matched: its arguments in order and the option elements inside them. */
interface Call {
  readonly node: Capture;
  readonly function?: string;
  readonly class?: Capture;
  readonly receiver?: string;
  readonly method?: string;
  readonly scope?: Capture;
  readonly staticMethod?: string;
  readonly arguments: Capture[];
}

const spanKey = (c: Capture): string => `${c.start.line}:${c.start.column}-${c.end.line}:${c.end.column}`;
const byStart = (a: Capture, b: Capture): number => (before(a.start, b.start) ? -1 : before(b.start, a.start) ? 1 : 0);

/** A named argument's name and value (`url: $x`); a spread (`...$a`) is undefined. */
function argumentValue(argument: Capture): { readonly name?: string; readonly text: string } | undefined {
  const text = argument.text.trim();
  if (text.startsWith("...")) return undefined;
  const named = /^([A-Za-z_]\w*)\s*:(?!:)/.exec(text);
  return named ? { name: named[1]!, text: text.slice(named[0].length).trim() } : { text };
}

/** The argument at `position`, else the one named `name`; undefined after a spread. */
function argumentAt(call: Call, position: number, name: string): Capture | undefined {
  for (const [i, argument] of call.arguments.entries()) {
    const value = argumentValue(argument);
    if (value === undefined) return undefined;
    if (value.name === undefined ? i === position : value.name === name) return argument;
  }
  return undefined;
}

const argumentText = (argument: Capture | undefined): string | undefined => (argument === undefined ? undefined : argumentValue(argument)?.text);

/** The query's calls, each once, with their arguments in order. */
function readCalls(captures: readonly Capture[]): Call[] {
  const calls = new Map<string, { node: Capture; parts: Capture[]; arguments: Map<string, Capture> }>();
  const nodes = captures.filter((c) => c.name === "out.call");
  for (const node of nodes) if (!calls.has(spanKey(node))) calls.set(spanKey(node), { node, parts: [], arguments: new Map() });
  const parts = captures.filter((c) => ["out.function", "out.class", "out.receiver", "out.method", "out.scope", "out.static_method", "out.argument"].includes(c.name));
  // Strict: an argument that is itself a matched call (`new SoapClient(getenv('X'))`) has that call's span, and belongs to the outer one.
  innermostEach(nodes, parts, true).forEach((owner, i) => {
    const call = owner && calls.get(spanKey(owner));
    const part = parts[i]!;
    if (!call) return;
    if (part.name === "out.argument") call.arguments.set(spanKey(part), part);
    else call.parts.push(part);
  });
  return [...calls.values()].map(({ node, parts: named, arguments: args }) => {
    // Parts of a nested call inside an argument have their own owner; the first part of each name is the call's own.
    const part = (name: string): Capture | undefined => named.filter((c) => c.name === name).sort(byStart)[0];
    return {
      node,
      function: part("out.function")?.text.replace(/^\\/, "").toLowerCase(),
      class: part("out.class"),
      receiver: part("out.receiver")?.text.replace(/\s+/g, ""),
      method: part("out.method")?.text.toLowerCase(),
      scope: part("out.scope"),
      staticMethod: part("out.static_method")?.text.toLowerCase(),
      arguments: [...args.values()].sort(byStart),
    };
  });
}

/** The option elements (`'base_uri' => …`, `CURLOPT_URL => …`) of an array argument, by key without quotes or `\`. */
function optionsOf(argument: Capture | undefined, elements: readonly Element[]): Map<string, Element> {
  const out = new Map<string, Element>();
  if (argument === undefined) return out;
  for (const element of elements) {
    if (element.argument === argument && !out.has(element.key)) out.set(element.key, element);
  }
  return out;
}

interface Element {
  readonly key: string;
  readonly value: Capture;
  readonly argument: Capture | undefined;
}

const GUZZLE_CLIENT = "guzzlehttp\\client";
const SOAP_CLIENT = "soapclient";
const HTTP_URL = /^https?:\/\//i;
const STREAM_FUNCTIONS: ReadonlySet<string> = new Set(["file_get_contents", "fopen", "file", "get_headers"]);
const GUZZLE_VERBS: ReadonlySet<string> = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

/** Database connection functions: client, the connection argument's place and name, how it is read, and the port argument's. */
interface DatabaseFunction {
  readonly client: string;
  readonly position: number;
  readonly name: string;
  readonly form: ConnectionForm;
  readonly port?: readonly [number, string];
}

const mysql: DatabaseFunction = { client: "mysql", position: 0, name: "server", form: "plain" };
const pgsql: DatabaseFunction = { client: "pgsql", position: 0, name: "connection_string", form: "pairs" };
const oci8: DatabaseFunction = { client: "oci8", position: 2, name: "connection_string", form: "plain" };
const odbc: DatabaseFunction = { client: "odbc", position: 0, name: "dsn", form: "pairs" };
/** mysqli's port, after hostname, username, password and database. */
const MYSQLI_PORT = [4, "port"] as const;
const MYSQLI: DatabaseFunction = { client: "mysqli", position: 0, name: "hostname", form: "plain", port: MYSQLI_PORT };

/** A mysqli host without its persistent-connection prefix `p:` (https://www.php.net/manual/en/mysqli.persistconns.php). */
function mysqliHost(host: Target): Target {
  if (host.targetSource !== "literal" || !host.target.startsWith("p:")) return host;
  return literal(host.target.slice(2));
}

const DATABASE_FUNCTIONS: Readonly<Record<string, DatabaseFunction>> = {
  mysql_connect: mysql,
  mysql_pconnect: mysql,
  mysqli_connect: MYSQLI,
  pg_connect: pgsql,
  pg_pconnect: pgsql,
  oci_connect: oci8,
  oci_pconnect: oci8,
  oci_new_connect: oci8,
  sqlsrv_connect: { client: "sqlsrv", position: 0, name: "serverName", form: "plain" },
  odbc_connect: odbc,
  odbc_pconnect: odbc,
};

/**
 * Cache classes, by qualified name in lowercase: client and the methods that
 * name a server (host first, port second). A Map, since a key is a class name
 * from the repository (`Constructor`, `__proto__`).
 */
const CACHE_CLASSES: ReadonlyMap<string, { readonly client: string; readonly methods: ReadonlySet<string> }> = new Map([
  ["memcache", { client: "memcache", methods: new Set(["connect", "pconnect", "addserver"]) }],
  ["memcached", { client: "memcached", methods: new Set(["addserver"]) }],
  ["redis", { client: "redis", methods: new Set(["connect", "pconnect", "open", "popen"]) }],
]);

const MYSQLI_CLASS = "mysqli";
const PDO_CLASS = "pdo";
const PREDIS_CLIENT = "predis\\client";
const DBAL_DRIVER_MANAGER = "doctrine\\dbal\\drivermanager";

/** The function names the query's call pattern must match, so a test can hold the two in step. */
export const PHP_OUTBOUND_FUNCTIONS: readonly string[] = ["curl_init", "curl_setopt", "curl_setopt_array", ...STREAM_FUNCTIONS, "fsockopen", "getenv", ...Object.keys(DATABASE_FUNCTIONS)];
/** The Guzzle and cache method names the query's method pattern must match. */
export const PHP_OUTBOUND_METHODS: readonly string[] = [
  ...[...GUZZLE_VERBS, "request"].flatMap((m) => [m, `${m}async`]),
  ...new Set([...CACHE_CLASSES.values()].flatMap((c) => [...c.methods])),
];

// ── One file ────────────────────────────────────────────────────────────────

/** One file's outbound calls, in document order. */
export function readFileOutbound(file: PackSourceFile, constant: ConstantLookup): OutboundCallFact[] {
  const captures = file.captures[OUTBOUND_QUERY] ?? [];
  if (captures.length === 0) return [];
  const targets = new TargetReader(file, constant);
  const facts: OutboundCallFact[] = [];
  const add = (kind: OutboundCallFact["kind"], client: string, target: Target, position: SourcePosition): void => {
    facts.push({ kind, ...target, client, confidence: "certain", position });
  };

  // Classes as PHP qualifies them (`new X`, `X::m()`), by the position of the name.
  const classes = new Map<string, string>();
  for (const ref of readPhpReferences(file)) {
    if (ref.form === "new" || ref.form === "static") classes.set(`${ref.position.line}:${ref.position.column}`, ref.qualified.toLowerCase());
  }
  const classOf = (c: Capture | undefined): string | undefined => c && classes.get(`${c.start.line}:${c.start.column}`);

  const calls = readCalls(captures);
  const argumentsOf = calls.flatMap((c) => c.arguments);
  const elementNodes = captures.filter((c) => c.name === "out.element");
  const elementParts = captures.filter((c) => c.name === "out.element_key" || c.name === "out.element_value");
  const parts = new Map<string, { key?: Capture; value?: Capture }>();
  innermostEach(elementNodes, elementParts).forEach((owner, i) => {
    if (!owner) return;
    const entry = parts.get(spanKey(owner)) ?? {};
    entry[elementParts[i]!.name === "out.element_key" ? "key" : "value"] ??= elementParts[i]!;
    parts.set(spanKey(owner), entry);
  });
  const uniqueElements = [...new Map(elementNodes.map((e) => [spanKey(e), e])).values()];
  const elementArguments = innermostEach(argumentsOf, uniqueElements);
  const elements: Element[] = uniqueElements.flatMap((node, i) => {
    const { key, value } = parts.get(spanKey(node)) ?? {};
    if (!key || !value) return [];
    return [{ key: key.text.replace(/^['"\\]|['"]$/g, ""), value, argument: elementArguments[i] }];
  });

  // The class of a receiver every assignment in its scope binds to a `new` of that class.
  const assigned = new Map<string, string | null>();
  const scopeKey = (receiver: string, at: SourcePosition): string => {
    if (!VARIABLE.test(receiver)) return receiver; // a property: the file
    const scope = scopeAt(file, at);
    return `${receiver}@${scope ? spanKey(scope) : ""}`;
  };
  // The class each `new` assignment binds, by the span of its variable or property.
  const boundParts = captures.filter((c) => c.name === "out.bound_target" || c.name === "out.bound_class");
  const bound = new Map<string, { target?: Capture; class?: Capture }>();
  innermostEach(
    captures.filter((c) => c.name === "out.bound"),
    boundParts,
  ).forEach((owner, i) => {
    if (!owner) return;
    const entry = bound.get(spanKey(owner)) ?? {};
    entry[boundParts[i]!.name === "out.bound_target" ? "target" : "class"] ??= boundParts[i]!;
    bound.set(spanKey(owner), entry);
  });
  const boundClass = new Map<string, Capture>();
  for (const { target, class: klass } of bound.values()) if (target && klass) boundClass.set(spanKey(target), klass);
  for (const target of captures.filter((c) => c.name === "out.assigned")) {
    const key = scopeKey(target.text.replace(/\s+/g, ""), target.start);
    const klass = classOf(boundClass.get(spanKey(target))) ?? null;
    const earlier = assigned.get(key);
    assigned.set(key, earlier === undefined || earlier === klass ? klass : null);
  }
  const receiverClass = (receiver: string, at: SourcePosition): string | undefined => assigned.get(scopeKey(receiver, at)) ?? undefined;
  const port = (host: Target, argument: Capture | undefined, at: SourcePosition): Target => targets.withPort(host, argument, at);
  const server = (call: Call, at: SourcePosition): Target => {
    const host = argumentTarget(call, argumentAt(call, 0, "host"));
    return port(credentialFree(host), argumentAt(call, 1, "port"), at);
  };
  /** A connection-parameter array: its `url`, else its `host` with its `port`, else its `path`. */
  const parameters = (options: Map<string, Element>, at: SourcePosition): Target => {
    const url = options.get("url");
    if (url) return credentialFree(targets.of(url.value.text, at));
    const host = options.get("host");
    if (host) return targets.withPort(credentialFree(targets.of(host.value.text, at)), options.get("port")?.value, at);
    const path = options.get("path");
    return path ? targets.of(path.value.text, at) : UNKNOWN;
  };
  const argumentTarget = (call: Call, argument: Capture | undefined): Target => {
    const text = argumentText(argument);
    return text === undefined ? UNKNOWN : targets.of(text, call.node.start);
  };

  for (const call of calls) {
    const at = call.node.start;
    const target = (argument: Capture | undefined): Target => argumentTarget(call, argument);
    const connection = (argument: Capture | undefined, form: ConnectionForm): Connection => {
      const text = argumentText(argument);
      return text === undefined ? { target: UNKNOWN } : targets.connection(text, at, form);
    };
    if (call.function !== undefined) {
      const name = call.function;
      const database = DATABASE_FUNCTIONS[name];
      if (database !== undefined) {
        const written = connection(argumentAt(call, database.position, database.name), database.form).target;
        const host = database === MYSQLI ? mysqliHost(written) : written;
        add("database", database.client, database.port ? port(host, argumentAt(call, ...database.port), at) : host, at);
      } else if (name === "curl_init") {
        const url = argumentAt(call, 0, "url");
        if (url) add("http", "curl", target(url), at);
      } else if (name === "curl_setopt") {
        const option = argumentText(argumentAt(call, 1, "option"));
        if (option?.replace(/^\\/, "") === "CURLOPT_URL") add("http", "curl", target(argumentAt(call, 2, "value")), at);
      } else if (name === "curl_setopt_array") {
        const url = optionsOf(argumentAt(call, 1, "options"), elements).get("CURLOPT_URL");
        if (url) add("http", "curl", targets.of(url.value.text, at), at);
      } else if (STREAM_FUNCTIONS.has(name)) {
        const url = target(argumentAt(call, 0, "filename"));
        if (url.targetSource === "literal" && HTTP_URL.test(url.target)) add("http", name, url, at);
      } else if (name === "fsockopen") {
        add("http", "fsockopen", target(argumentAt(call, 0, "hostname")), at);
      } else if (name === "getenv") {
        const key = envKey(call.node.text);
        if (key !== undefined && argumentAt(call, 0, "name")) add("env", "getenv", key === "" ? UNKNOWN : { target: key, targetSource: "env" }, at);
      }
      continue;
    }
    if (call.class !== undefined) {
      const qualified = classOf(call.class);
      if (qualified === SOAP_CLIENT) {
        const wsdl = argumentAt(call, 0, "wsdl");
        const location = optionsOf(argumentAt(call, 1, "options"), elements).get("location");
        const isNull = argumentText(wsdl)?.toLowerCase() === "null";
        add("http", "SoapClient", isNull && location ? targets.of(location.value.text, at) : isNull ? UNKNOWN : target(wsdl), at);
      } else if (qualified === GUZZLE_CLIENT) {
        const options = optionsOf(argumentAt(call, 0, "config"), elements);
        const base = options.get("base_uri") ?? options.get("base_url");
        if (base) add("http", "guzzle", targets.of(base.value.text, at), at);
      } else if (qualified === MYSQLI_CLASS) {
        add("database", "mysqli", port(mysqliHost(connection(argumentAt(call, 0, "hostname"), "plain").target), argumentAt(call, ...MYSQLI_PORT), at), at);
      } else if (qualified === PDO_CLASS) {
        const { target: dsn, driver } = connection(argumentAt(call, 0, "dsn"), "dsn");
        add("database", (driver && PDO_DRIVERS.get(driver)) || "pdo", dsn, at);
      } else if (qualified === PREDIS_CLIENT) {
        const given = argumentAt(call, 0, "parameters");
        const options = optionsOf(given, elements);
        add("cache", "predis", options.size > 0 ? parameters(options, at) : credentialFree(target(given)), at);
      }
      continue;
    }
    if (call.scope !== undefined) {
      if (call.staticMethod === "getconnection" && classOf(call.scope) === DBAL_DRIVER_MANAGER) {
        add("database", "doctrine-dbal", parameters(optionsOf(argumentAt(call, 0, "params"), elements), at), at);
      }
      continue;
    }
    if (call.receiver === undefined || call.method === undefined) continue;
    const receiver = receiverClass(call.receiver, at);
    if (receiver === GUZZLE_CLIENT) {
      const method = call.method.replace(/async$/, "");
      if (GUZZLE_VERBS.has(method)) add("http", "guzzle", target(argumentAt(call, 0, "uri")), at);
      else if (method === "request") add("http", "guzzle", target(argumentAt(call, 1, "uri")), at);
    } else if (receiver !== undefined) {
      const cache = CACHE_CLASSES.get(receiver);
      if (cache?.methods.has(call.method)) add("cache", cache.client, server(call, at), at);
    }
  }

  // Environment reads through $_ENV and $_SERVER.
  const written = new Set(captures.filter((c) => c.name === "out.written").map(spanKey));
  for (const read of captures.filter((c) => c.name === "out.superglobal")) {
    if (written.has(spanKey(read))) continue;
    const text = read.text.trim();
    const superglobal = SUPERGLOBAL_ANY.exec(text);
    if (!superglobal) continue;
    const key = envKey(text);
    if (key === undefined) continue;
    add("env", `$_${superglobal[1]}`, key === "" ? UNKNOWN : { target: key, targetSource: "env" }, read.start);
  }

  const seen = new Set<string>();
  return facts
    .filter((f) => {
      const key = `${f.position.line}:${f.position.column}|${f.kind}|${f.client}|${f.target}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (before(a.position, b.position) ? -1 : before(b.position, a.position) ? 1 : 0));
}

/** Every outbound call of a project, by file. */
export function readOutbound(files: readonly PackSourceFile[]): FrameworkFacts {
  const constant = repositoryConstants(files);
  const facts = new Map<string, Omit<FileFacts, "path">>();
  for (const file of files) {
    const calls = readFileOutbound(file, constant);
    if (calls.length > 0) facts.set(file.path, { outboundCalls: calls });
  }
  return { facts, notices: [] };
}

export const phpOutbound: FrameworkPack = {
  id: "php-outbound",
  produces: ["outboundCalls"],
  // A getter, so the path is computed on first use rather than at import.
  get queries() {
    return [{ name: OUTBOUND_QUERY, path: join(PHP_PACKAGE.queryDir("php-outbound"), `${OUTBOUND_QUERY}.scm`) }];
  },
  provenance: PROVENANCE,
  read(files: readonly PackSourceFile[], kinds: readonly FactKind[]): FrameworkFacts {
    return kinds.includes("outboundCalls") ? readOutbound(files) : { facts: new Map(), notices: [] };
  },
};
