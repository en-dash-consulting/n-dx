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

// Atlassian credential fixtures.
//
// These are shaped after published detector rulesets, not after the regexes
// in redact.ts. That distinction is the point: the previous fixtures were
// runs of a single letter chosen to clear the length floor, so they matched
// whatever class the rule happened to declare and could never show that a
// real credential would not. Every fixture below therefore carries the body
// characters its ruleset documents — `-`, `_`, `+`, `/`, `.`, `=` — and
// `ATLASSIAN_BODY_CHARACTERS` drives a test that fails if any of them is left
// behind.
//
// Sources, one per kind:
//   ATBB   trufflehog pkg/detectors/bitbucketapppassword — `ATBB[A-Za-z0-9_=.-]+`,
//          fixture `ATBBa9iO-tyg7u_op`
//   ATCTT  trufflehog pkg/detectors/atlassian/v2 —
//          `ATCTT3xFfG[A-Za-z0-9+/=_-]+=[A-Za-z0-9]{8}`
//   ATATT  gitleaks atlassian-api-token — `ATATT3[A-Za-z0-9_\-=]{186}`, 192 all told
//   BBDC-  GitGuardian bitbucket_http_access_token_prefixed (prefixed since
//          Bitbucket Data Center 8); glsec `BBDC-[A-Za-z0-9+/=]{32,}`

/** Body characters the rulesets above document, across all four kinds. */
const ATLASSIAN_BODY_CHARACTERS = ["-", "_", "+", "/", ".", "="];

/** A base64url-ish body of `length` characters that exercises `extra`. */
function body(length: number, extra: string): string {
  const alphabet = `ABCdef123${extra}`;
  return Array.from({ length }, (_, i) => alphabet[i % alphabet.length]).join("");
}

// Real app passwords are short — trufflehog's fixture has a 13-character body
// — and carry `-` and `_`, which is what the old `[A-Za-z0-9]` class missed.
const BB_APP_PASSWORD = "ATBB" + body(16, "-_.=");
// 192 characters all told, ending in `=` plus 8 hex of CRC32, with `+` and
// `/` in the body as trufflehog's sample has.
const BB_ACCESS_TOKEN = "ATCTT3xFfGN0" + body(171, "-_+/") + "=366BFE3A";
const ATLASSIAN_API_TOKEN = "ATATT3xFfGF0" + body(171, "-_+/") + "=C63992E6";
// Plain base64, per glsec's fixture of `Ab+/` repeated.
const BB_DC_TOKEN = "BBDC-" + body(44, "+/=");

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

describe("redactSecrets — Bitbucket and Atlassian credentials", () => {
  it("replaces prefixed Bitbucket Cloud and Data Center credentials wherever they appear", () => {
    for (const secret of [BB_APP_PASSWORD, BB_ACCESS_TOKEN, ATLASSIAN_API_TOKEN, BB_DC_TOKEN]) {
      const out = redactSecrets(`remote: rejected\nusing ${secret} for bitbucket.org`);
      expect(out).not.toContain(secret);
      expect(out).toBe(`remote: rejected\nusing ${REDACTED_TOKEN} for bitbucket.org`);
    }
  });

  it("leaves no fragment of a body behind, whichever documented character it contains", () => {
    // The failure these patterns actually had: a body character outside the
    // class ends the match, the prefix is replaced, and the tail stays in the
    // record in plain text. A test that only asserts `not.toContain(secret)`
    // passes on exactly that — the whole token is indeed gone — so this
    // checks each *suffix* instead, which is what would survive.
    for (const secret of [BB_APP_PASSWORD, BB_ACCESS_TOKEN, ATLASSIAN_API_TOKEN, BB_DC_TOKEN]) {
      const out = redactSecrets(`using ${secret} for bitbucket.org`);
      for (const char of ATLASSIAN_BODY_CHARACTERS) {
        const at = secret.indexOf(char);
        if (at === -1) continue;
        const tail = secret.slice(at + 1);
        // 8+ characters so the check cannot pass on a tail short enough to
        // occur by chance in the surrounding sentence.
        if (tail.length < 8) continue;
        expect(
          out,
          `the body after ${JSON.stringify(char)} in ${secret.slice(0, 12)}… survived redaction`,
        ).not.toContain(tail.slice(0, 16));
      }
    }
  });

  it("redacts a credential shaped exactly like the ruleset fixtures it was checked against", () => {
    // Verbatim from trufflehog's bitbucketapppassword and atlassian/v2
    // fixtures. Keeping them as literals is the one thing a generated fixture
    // cannot do: these came from the ruleset, not from this file's idea of
    // the format.
    const truffleAppPassword = "ATBBa9iO-tyg7u_op";
    const truffleAccessToken =
      "ATCTT3xFfGN0GsZNgOGrQSHSnxiJVi00oHlRicyM0yMNuKCBfw6qOHVcCy4Hm89GnclGb_W-1qAkxqCn5Xbuyo" +
      "X54bNhpK5yFKGFR7ocV6FByvL_P9Sb3tFnbUg3T3I3S_RGCBLMSN7Nsa4GJv8JEJ6bzvDmX-oJ8AnrazMU-zZ5" +
      "hb-u3t2ERew=366BFE3A";

    // Bare text, deliberately: `password: …` and `token=…` are caught by the
    // key/value rule before the token pattern is reached, so an assignment-form
    // fixture reports [redacted:value] and passes against the narrow classes
    // this test exists to catch. Bare, the old ATBB class stopped at the first
    // `-` and left `tyg7u_op` in the clear.
    expect(redactSecrets(`got ${truffleAppPassword} here`)).toBe(`got ${REDACTED_TOKEN} here`);
    expect(redactSecrets(`got ${truffleAccessToken} here`)).toBe(`got ${REDACTED_TOKEN} here`);
  });

  it("redacts the assignment forms a pipeline uses", () => {
    // A prefixed credential is recognised by shape before the assignment rule
    // reaches it, so it reports as a token — the same way `ANTHROPIC_API_KEY=`
    // already does. Either marker means the secret is gone.
    expect(redactSecrets(`BITBUCKET_APP_PASSWORD=${BB_APP_PASSWORD}`)).toBe(
      `BITBUCKET_APP_PASSWORD=${REDACTED_TOKEN}`,
    );
    expect(redactSecrets(`BITBUCKET_ACCESS_TOKEN=${BB_ACCESS_TOKEN}`)).toBe(
      `BITBUCKET_ACCESS_TOKEN=${REDACTED_TOKEN}`,
    );
    // An app password predating the ATBB prefix has no shape of its own; the
    // key is the only thing that gives it away.
    expect(redactSecrets("bitbucket_app_password: 7sRk2mQp9vLx3nTw")).toBe(
      `bitbucket_app_password: ${REDACTED_VALUE}`,
    );
  });

  it("redacts an app password sent as a Basic auth header", () => {
    // base64("ryan:s3cr3tpassword") — how Bitbucket Cloud's own docs send an
    // app password. No other rule looks inside a Basic header.
    expect(redactSecrets("Authorization: Basic cnlhbjpzM2NyM3RwYXNzd29yZA==")).toBe(
      `Authorization: Basic ${REDACTED_TOKEN}`,
    );
    expect(redactSecrets("curl -H 'Authorization: Basic cnlhbjpzM2NyM3RwYXNzd29yZA==' https://api.bitbucket.org/2.0/user")).toBe(
      `curl -H 'Authorization: Basic ${REDACTED_TOKEN}' https://api.bitbucket.org/2.0/user`,
    );
  });

  it("redacts a curl -u credential, keeping the username", () => {
    expect(redactSecrets("curl -u ryan:s3cr3tpassword https://api.bitbucket.org/2.0/user")).toBe(
      `curl -u ryan:${REDACTED_PASSWORD} https://api.bitbucket.org/2.0/user`,
    );
    // The unprefixed app password is the case this rule exists for — nothing
    // else marks it as a credential.
    expect(redactSecrets("git clone --user bot:7sRk2mQp9vLx3nTw repo")).toBe(
      `git clone --user bot:${REDACTED_PASSWORD} repo`,
    );
    // A prefixed one is already gone by the time this rule runs, and the
    // marker left behind must not be redacted a second time.
    expect(redactSecrets(`git clone --user bot:${BB_APP_PASSWORD} repo`)).toBe(
      `git clone --user bot:${REDACTED_TOKEN} repo`,
    );
  });

  it("drops an app password embedded in a Bitbucket clone URL", () => {
    expect(redactSecrets(`git remote add origin https://ryan:${BB_APP_PASSWORD}@bitbucket.org/w/r.git`)).toBe(
      `git remote add origin https://ryan:${REDACTED_PASSWORD}@bitbucket.org/w/r.git`,
    );
  });

  it("leaves Bitbucket prose, identifiers and lookalike flags alone", () => {
    const prose = [
      "Basic authentication is required for the Bitbucket API",
      "Basic internationalization support landed",
      "docker run -u 1000:1000 alpine",
      "psql -u postgres localhost",
      // A URL or a Windows path after the flag holds a colon too, but what
      // follows it starts with a slash — never a password. Real userinfo in a
      // URL is the url-password rule's job.
      "pip install --user git+https://github.com/org/repo.git",
      "git push -u https://github.com/org/repo.git main",
      "diff -u C:\\Users\\ryan\\a.txt C:\\Users\\ryan\\b.txt",
      "See bitbucket-pipelines.yml for the ATBB migration notes",
    ].join("\n");
    expect(redactSecrets(prose)).toBe(prose);
  });

  it("is idempotent over every Bitbucket form", () => {
    const text = [
      `token ${BB_APP_PASSWORD}`,
      "Authorization: Basic cnlhbjpzM2NyM3RwYXNzd29yZA==",
      "curl -u ryan:s3cr3tpassword https://api.bitbucket.org",
      `https://ryan:${BB_DC_TOKEN}@bitbucket.example/w/r.git`,
    ].join("\n");
    const r = redactSecretsDetailed(text);
    expect(r.kinds).toEqual(["token", "basic-auth", "user-password", "url-password"]);
    const once = r.text;
    expect(once).not.toContain(BB_APP_PASSWORD);
    expect(once).not.toContain(BB_DC_TOKEN);
    expect(once).not.toContain("s3cr3tpassword");
    expect(redactSecrets(once)).toBe(once);
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

  it("names each kind once however many rules of that kind fired", () => {
    // `assignment` is two rules — quoted and unquoted — and `kinds` is
    // documented as naming a kind once. Both firing used to list it twice.
    const r = redactSecretsDetailed('api_key="abcdefghij"\ntoken=abcdefghijkl');
    expect(r.count).toBe(2);
    expect(r.kinds).toEqual(["assignment"]);
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
