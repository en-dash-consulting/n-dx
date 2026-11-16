import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { connectionTarget, envKey, isRequestKey, PHP_OUTBOUND_FUNCTIONS, PHP_OUTBOUND_METHODS, withoutCredentials } from "../../src/index.js";

const query = readFileSync(join(import.meta.dirname, "..", "..", "queries", "php-outbound", "outbound.scm"), "utf8");

/** The `#match?` regex the query gives `capture`, as tree-sitter compiles it. */
function predicate(capture: string): RegExp {
  const m = new RegExp(String.raw`\(#match\? @${capture.replace(".", "\\.")} "((?:[^"\\]|\\.)*)"\)`).exec(query);
  if (!m) throw new Error(`no #match? on @${capture}`);
  return new RegExp(JSON.parse(`"${m[1]}"`) as string);
}

describe("php outbound query", () => {
  it("matches every client function, in any case and with a leading \\", () => {
    const re = predicate("out.function");
    for (const name of PHP_OUTBOUND_FUNCTIONS) {
      expect(re.test(name), name).toBe(true);
      expect(re.test(name.toUpperCase()), name).toBe(true);
      expect(re.test(`\\${name}`), name).toBe(true);
    }
    expect(re.test("mail")).toBe(false);
    expect(re.test("App\\curl_init")).toBe(false);
  });

  it("matches every Guzzle and cache method, in any case", () => {
    const re = predicate("out.method");
    for (const name of PHP_OUTBOUND_METHODS) {
      expect(re.test(name), name).toBe(true);
      expect(re.test(name.toUpperCase()), name).toBe(true);
    }
    expect(re.test("send")).toBe(false);
  });
});

describe("connectionTarget", () => {
  it("reads a DSN's driver and host", () => {
    expect(connectionTarget("mysql:host=db;port=3307;dbname=shop", "dsn")).toEqual({ target: { target: "db:3307", targetSource: "literal" }, driver: "mysql" });
    expect(connectionTarget("mysql:unix_socket=/tmp/mysql.sock;dbname=shop", "dsn").target.target).toBe("/tmp/mysql.sock");
    expect(connectionTarget("sqlsrv:Server=mssql,1433;Database=hr", "dsn").target.target).toBe("mssql,1433");
    expect(connectionTarget("oci:dbname=//oracle:1521/ORCL", "dsn").target.target).toBe("//oracle:1521/ORCL");
    expect(connectionTarget("sqlite::memory:", "dsn")).toEqual({ target: { target: ":memory:", targetSource: "literal" }, driver: "sqlite" });
  });

  it("is unknown for a DSN with no host value or no driver", () => {
    expect(connectionTarget("mysql:host=", "dsn").target.targetSource).toBe("unknown");
    expect(connectionTarget("no-driver", "dsn").target.targetSource).toBe("unknown");
  });

  it("reads a pg_connect string's host, quoted or not, and never its password", () => {
    expect(connectionTarget("host='pg' port=5433 password=secret", "pairs").target.target).toBe("pg:5433");
    expect(connectionTarget("dbname=local", "pairs").target.target).toBe("local");
  });

  it("drops a URI's user and password", () => {
    expect(connectionTarget("mysql://app:secret@db/app", "plain").target.target).toBe("mysql://db/app");
    expect(withoutCredentials("tcp://:secret@cache:6379")).toBe("tcp://cache:6379");
    expect(withoutCredentials("https://example.com/a@b")).toBe("https://example.com/a@b");
  });
});

describe("isRequestKey", () => {
  it("is true for the request and script keys of $_SERVER", () => {
    for (const key of ["HTTP_HOST", "HTTP_X_FORWARDED_FOR", "REQUEST_URI", "REQUEST_METHOD", "QUERY_STRING", "REMOTE_ADDR", "SERVER_NAME", "SERVER_PORT", "SERVER_ADDR", "SCRIPT_NAME", "PHP_SELF", "DOCUMENT_ROOT", "HTTPS", "argv", "PHP_AUTH_USER", "CONTENT_TYPE"]) {
      expect(isRequestKey(key), key).toBe(true);
    }
  });

  it("is false for anything else, case-sensitively", () => {
    for (const key of ["APP_ENV", "DB_HOST", "SERVER_ROLE", "https", "ARGV"]) expect(isRequestKey(key), key).toBe(false);
  });
});

describe("envKey", () => {
  it("names the variable of getenv, $_ENV and $_SERVER reads", () => {
    expect(envKey("getenv('A')")).toBe("A");
    expect(envKey('\\GETENV("B", true)')).toBe("B");
    expect(envKey("$_ENV['C']")).toBe("C");
    expect(envKey('$_SERVER [ "D" ]')).toBe("D");
    expect(envKey("$_SERVER[E]")).toBe("E");
  });

  it("is empty for a key that is not a literal, except $_SERVER's, which may be a request key", () => {
    expect(envKey("getenv($name)")).toBe("");
    expect(envKey("$_ENV[$name]")).toBe("");
    expect(envKey("$_SERVER[$name]")).toBeUndefined();
  });

  it("is undefined for request keys and other expressions", () => {
    expect(envKey("$_SERVER['HTTP_HOST']")).toBeUndefined();
    expect(envKey("$_GET['A']")).toBeUndefined();
    expect(envKey("my_getenv('A')")).toBeUndefined();
  });
});
