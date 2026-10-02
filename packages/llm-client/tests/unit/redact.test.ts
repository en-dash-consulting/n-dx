import { describe, expect, it } from "vitest";
import {
  REDACTED_KEY_BLOCK,
  REDACTED_PASSWORD,
  REDACTED_TOKEN,
  REDACTED_VALUE,
  redactDeep,
  redactSecrets,
  redactSecretsDetailed,
} from "../../src/redact.js";

const ANTHROPIC = "sk-ant-api03-" + "A".repeat(40);
const GITHUB = "ghp_" + "b".repeat(36);
const AWS = "AKIA" + "C".repeat(16);
const JWT = `eyJ${"a".repeat(10)}.${"b".repeat(20)}.${"c".repeat(20)}`;

describe("redactSecrets — well-known shapes", () => {
  it("replaces vendor tokens wherever they appear", () => {
    const text = `export ANTHROPIC_API_KEY=${ANTHROPIC}\ncurl -H "x: ${GITHUB}" ; aws ${AWS} ; jwt ${JWT}`;
    const out = redactSecrets(text);
    expect(out).not.toContain(ANTHROPIC);
    expect(out).not.toContain(GITHUB);
    expect(out).not.toContain(AWS);
    expect(out).not.toContain(JWT);
    expect(out.split(REDACTED_TOKEN).length - 1).toBeGreaterThanOrEqual(3);
  });

  it("replaces private-key blocks and bearer headers, keeping the surrounding text", () => {
    const key = "-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----";
    expect(redactSecrets(`before\n${key}\nafter`)).toBe(`before\n${REDACTED_KEY_BLOCK}\nafter`);
    expect(redactSecrets("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123")).toBe(`Authorization: Bearer ${REDACTED_TOKEN}`);
  });

  it("drops the password from a URL but keeps the user and host", () => {
    expect(redactSecrets("DATABASE_URL=postgres://app:hunter2secret@db.example:5432/x"))
      .toBe(`DATABASE_URL=postgres://app:${REDACTED_PASSWORD}@db.example:5432/x`);
  });
});

describe("redactSecrets — credential-shaped assignments", () => {
  it("keeps the key and replaces the value in env, YAML and JSON forms", () => {
    expect(redactSecrets("GITHUB_TOKEN=abcdefgh1234")).toBe(`GITHUB_TOKEN=${REDACTED_VALUE}`);
    expect(redactSecrets("client_secret: s3cr3tvalue")).toBe(`client_secret: ${REDACTED_VALUE}`);
    expect(redactSecrets('"api_key": "sk-live-abcdefghij"')).toBe(`"api_key": "${REDACTED_VALUE}"`);
    expect(redactSecrets("AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG")).toBe(`AWS_SECRET_ACCESS_KEY=${REDACTED_VALUE}`);
    expect(redactSecrets("password = 'correcthorsebattery'")).toBe(`password = '${REDACTED_VALUE}'`);
  });

  it("leaves run-record fields and counters alone", () => {
    const record = JSON.stringify({
      tokenUsage: { input: 12345678, output: 87654321 },
      totalTokens: 99999999,
      tokenDiagnosticStatus: "unavailable",
      tokenBudget: 0,
      taskKey: "abc12345",
      summary: "Added the token counter to the status bar",
    });
    expect(redactSecrets(record)).toBe(record);
  });

  it("does not touch short or purely numeric values", () => {
    expect(redactSecrets("token=abc")).toBe("token=abc");
    expect(redactSecrets("secret: 12345678")).toBe("secret: 12345678");
  });

  it("takes the whole value when it contains spaces, quoted or not", () => {
    // The value stopped at the first space, so a passphrase was left almost
    // entirely in the clear — and an unquoted one matched nothing at all,
    // because its first word was under the length floor.
    expect(redactSecrets("PASSWORD=correct horse battery")).toBe(`PASSWORD=${REDACTED_VALUE}`);
    expect(redactSecrets('PASSWORD="correct horse battery staple"')).toBe(`PASSWORD="${REDACTED_VALUE}"`);
    expect(redactSecrets("passphrase: 'a long secret phrase'")).toBe("passphrase: 'a long secret phrase'");
    // A quoted value keeps its exact bounds — what follows the closing quote is
    // not part of the secret and stays readable.
    expect(redactSecrets('api_key="abcdefghij" rejected')).toBe(`api_key="${REDACTED_VALUE}" rejected`);
  });

  it("stops at the end of the line, not the end of the text", () => {
    // Multi-line output must not lose everything after the first assignment.
    expect(redactSecrets("token=abcdefghij leftover\nkept line")).toBe(
      `token=${REDACTED_VALUE}\nkept line`,
    );
    // A separator ends the value too, so JSON and shell lists survive.
    expect(redactSecrets("token=abcdefghij, kept")).toBe(`token=${REDACTED_VALUE}, kept`);
  });

  it("is idempotent", () => {
    const once = redactSecrets(`api_key=abcdefghijkl ${GITHUB}`);
    expect(redactSecrets(once)).toBe(once);
    // The quoted form is the one that regressed: a second pass used to match
    // the space before the opening quote and redact the marker again.
    const quoted = redactSecrets('"api_key": "sk-live-abcdefghij"');
    expect(quoted).toBe(`"api_key": "${REDACTED_VALUE}"`);
    expect(redactSecrets(quoted)).toBe(quoted);
    const spaced = redactSecrets("PASSWORD=correct horse battery");
    expect(redactSecrets(spaced)).toBe(spaced);
  });
});

describe("redactSecretsDetailed and redactDeep", () => {
  it("reports what fired", () => {
    const r = redactSecretsDetailed(`x ${GITHUB} y password=hunter2hunter2`);
    expect(r.count).toBe(2);
    expect(r.kinds).toEqual(["token", "assignment"]);
    expect(redactSecretsDetailed("nothing here").count).toBe(0);
  });

  it("walks objects and arrays, redacting string leaves only", () => {
    const run = {
      id: "run-1",
      turns: 3,
      toolCalls: [{ tool: "run_command", input: { command: "cat .env" }, output: `API_TOKEN=${GITHUB}\nPORT=3000` }],
      nested: { list: ["plain", `Bearer ${"z".repeat(20)}`], n: null },
    };
    const out = redactDeep(run);
    expect(out.id).toBe("run-1");
    expect(out.turns).toBe(3);
    expect(out.toolCalls[0].output).toBe(`API_TOKEN=${REDACTED_TOKEN}\nPORT=3000`);
    expect(out.toolCalls[0].input.command).toBe("cat .env");
    expect(out.nested.list[1]).toBe(`Bearer ${REDACTED_TOKEN}`);
    expect(out.nested.n).toBeNull();
    // The input is not mutated.
    expect(run.toolCalls[0].output).toContain(GITHUB);
  });
});
