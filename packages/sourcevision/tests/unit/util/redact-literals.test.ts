import { describe, expect, it } from "vitest";

import { isSecretName, redactLiterals, redactLiteralsDeep, REDACTED } from "../../../src/util/redact-literals.js";
import { toCanonicalJSON } from "../../../src/util/sort.js";

describe("redactLiterals", () => {
  it.each([
    ["https://u:pw@api.example.invalid/v1", "https://api.example.invalid/v1"],
    ["redis://:pw@cache.example.invalid:6379", "redis://cache.example.invalid:6379"],
    ["https://ghp_token@github.example.invalid/org/repo.git", "https://github.example.invalid/org/repo.git"],
    ["mysql://u:p@ss@db.example.invalid:3306/shop", "mysql://db.example.invalid:3306/shop"],
    ["ftp://u:pw@host.example.invalid", "ftp://host.example.invalid"],
  ])("drops the userinfo of %s", (input, expected) => {
    expect(redactLiterals(input)).toBe(expected);
  });

  it("replaces secret-shaped query values and keeps every other part", () => {
    expect(redactLiterals("https://api.example.invalid:8443/v2/items?id=7&api_key=abc123&Access-Token=xyz#top")).toBe(
      `https://api.example.invalid:8443/v2/items?id=7&api_key=${REDACTED}&Access-Token=${REDACTED}#top`,
    );
    expect(redactLiterals("https://u:pw@h.example.invalid/x?user=bob&password=hunter2&sig=s1")).toBe(
      `https://h.example.invalid/x?user=bob&password=${REDACTED}&sig=${REDACTED}`,
    );
  });

  it("redacts the password of key=value connection strings", () => {
    expect(redactLiterals("mysql:host=db.internal;dbname=shop;user=app;password=s3cret")).toBe(
      `mysql:host=db.internal;dbname=shop;user=app;password=${REDACTED}`,
    );
    expect(redactLiterals("pgsql:host=db;port=5432;dbname=x;pwd=s3cret;sslmode=require")).toBe(
      `pgsql:host=db;port=5432;dbname=x;pwd=${REDACTED};sslmode=require`,
    );
    expect(redactLiterals("Server=db;Database=x;Password=s3cret;")).toBe(`Server=db;Database=x;Password=${REDACTED};`);
    expect(redactLiterals("jdbc:sqlserver://db:1433;databaseName=x;password=s3cret")).toBe(
      `jdbc:sqlserver://db:1433;databaseName=x;password=${REDACTED}`,
    );
  });

  it.each([
    ["mysql:host=h;dbname=x;password=ab#cd", `mysql:host=h;dbname=x;password=${REDACTED}`],
    ["mysql:host=h;password=ab&cd?e;port=1", `mysql:host=h;password=${REDACTED};port=1`],
    ["Server=h;Password='s3 cret;x';Database=d", `Server=h;Password='${REDACTED}';Database=d`],
    ['Server=h;Password="s3cret"', `Server=h;Password="${REDACTED}"`],
    ["Driver={SQL Server};Server=h;Pwd={s3;cret}", `Driver={SQL Server};Server=h;Pwd={${REDACTED}}`],
    ["Server=h; Password=my secret;", `Server=h; Password=${REDACTED};`],
  ])("redacts the whole connection-string password of %s", (input, expected) => {
    expect(redactLiterals(input)).toBe(expected);
    expect(redactLiterals(expected)).toBe(expected);
  });

  it("finds literals inside prose and leaves everything else alone", () => {
    expect(redactLiterals("Calls `https://u:pw@api.example.invalid/v1?token=t0k` from src/a.php")).toBe(
      `Calls \`https://api.example.invalid/v1?token=${REDACTED}\` from src/a.php`,
    );
    for (const text of [
      "src/routes/index.php",
      "https://api.example.invalid:8080/v1?page=2&sort=name",
      "a == b && c = d",
      "user@example.invalid",
      "git@github.com:org/repo.git",
      "DB_PASSWORD",
      "mysql:host=db;dbname=shop",
    ]) {
      expect(redactLiterals(text)).toBe(text);
    }
  });

  it("is idempotent", () => {
    const once = redactLiterals("https://u:pw@h/x?token=t;password=p");
    expect(redactLiterals(once)).toBe(once);
  });
});

describe("isSecretName", () => {
  it.each(["password", "DB_PASS", "passwd", "pwd", "secret", "client_secret", "token", "access_token", "apiKey", "api-key", "x-api-key", "access_key", "auth", "key", "signature", "sig", "credentials", "X-Amz-Credential"])(
    "%s names a secret",
    (name) => expect(isSecretName(name)).toBe(true),
  );
  it.each(["user", "host", "dbname", "bypass", "monkey", "page", "sort", "id"])("%s does not", (name) =>
    expect(isSecretName(name)).toBe(false),
  );
});

describe("redactLiteralsDeep and toCanonicalJSON", () => {
  it("returns a clean value itself, uncopied", () => {
    const value = { files: [{ path: "a.ts", hash: "abc" }], n: 1 };
    expect(redactLiteralsDeep(value)).toBe(value);
  });

  it("redacts strings and keys at any depth in an artifact", () => {
    const outbound = {
      dependencies: [
        { file: "a.php", line: 2, kind: "http", target: "https://u:pw@api.example.invalid/v1", targetSource: "literal", client: "curl", confidence: "certain" },
      ],
      contracts: [],
      byTarget: { "https://u:pw@api.example.invalid/v1": 1 },
    };
    const json = toCanonicalJSON(outbound);
    expect(json).not.toContain("pw");
    expect(JSON.parse(json).dependencies[0].target).toBe("https://api.example.invalid/v1");
    expect(Object.keys(JSON.parse(json).byTarget)).toEqual(["https://api.example.invalid/v1"]);
  });
});
