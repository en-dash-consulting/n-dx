import { describe, expect, it } from "vitest";
import {
  REDACTED_KEY_BLOCK,
  REDACTED_PASSWORD,
  REDACTED_TOKEN,
  REDACTED_VALUE,
  createLineRedactor,
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

// ── Probe table ─────────────────────────────────────────────────────────
//
// Every case the redaction probe exercises, as a table. Each row says what
// the redactor must do with it: `redacted` rows must change and must not keep
// the secret; `untouched` rows must come back byte-for-byte, with the reason
// beside them. Both kinds are re-run through the redactor to prove the first
// pass is idempotent.

/** A 62-character alphabet, so every body char class is exercised. */
const K = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

type ProbeCase = {
  name: string;
  input: string;
  /** The text the secret must not survive as; defaults to the whole input. */
  secret?: string;
  /** Exact expected output, when its shape matters. */
  output?: string;
  /** Present when the row is left alone on purpose. */
  untouched?: string;
};

const PROBE: ProbeCase[] = [
  { name: "anthropic key", input: "x-api-key: sk-ant-api03-" + K.slice(0, 40) + "AA", output: `x-api-key: ${REDACTED_TOKEN}` },
  { name: "openai legacy", input: "export OPENAI_API_KEY=sk-" + K.slice(0, 48), output: `export OPENAI_API_KEY=${REDACTED_TOKEN}` },
  { name: "openai proj bare", input: "sk-proj-" + K.slice(0, 30) + "_-" + K.slice(0, 20), output: REDACTED_TOKEN },
  { name: "github ghp", input: "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8", output: REDACTED_TOKEN },
  { name: "github pat", input: "github_pat_11ABCDEFG0" + K.slice(0, 59), output: REDACTED_TOKEN },
  { name: "aws akid bare", input: "AKIAIOSFODNN7EXAMPLE", output: REDACTED_TOKEN },
  {
    name: "aws secret assignment",
    input: "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    output: `AWS_SECRET_ACCESS_KEY=${REDACTED_TOKEN}`,
  },
  {
    name: "aws secret bare",
    input: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    untouched: "forty base64 characters alone are also a content hash; the shape is only a secret beside an access key id or an aws_secret… name (see the next two rows)",
  },
  {
    name: "aws secret bare, beside its access key id",
    input: "AKIAIOSFODNN7EXAMPLE\nwJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    secret: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    output: `${REDACTED_TOKEN}\n${REDACTED_TOKEN}`,
  },
  {
    name: "aws secret bare, beside an aws_secret name",
    input: "$ echo $AWS_SECRET_ACCESS_KEY\nwJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    secret: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    output: `$ echo $AWS_SECRET_ACCESS_KEY\n${REDACTED_TOKEN}`,
  },
  {
    name: "jwt",
    input: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
    output: REDACTED_TOKEN,
  },
  { name: "bearer", input: "Authorization: Bearer " + K.slice(0, 40), output: `Authorization: Bearer ${REDACTED_TOKEN}` },
  { name: "bearer short 12", input: "Authorization: Bearer abcd1234efgh", output: `Authorization: Bearer ${REDACTED_TOKEN}` },
  {
    name: "token header DRF",
    input: "Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b",
    output: `Authorization: Token ${REDACTED_TOKEN}`,
  },
  { name: "url ?token=", input: "https://example.com/api?token=" + K.slice(0, 24) + "&x=1", secret: K.slice(0, 24) },
  { name: "url ?access_token=", input: "GET https://example.com/cb?access_token=" + K.slice(0, 24), secret: K.slice(0, 24) },
  {
    name: "url ?key= (google style)",
    input: "https://generativelanguage.googleapis.com/v1/models?key=AIza" + K.slice(0, 35),
    output: `https://generativelanguage.googleapis.com/v1/models?key=${REDACTED_TOKEN}`,
  },
  {
    name: "url ?sig= azure SAS",
    input: "https://acct.blob.core.windows.net/c/b?sv=2020&sig=" + K.slice(0, 43) + "%3D",
    output: `https://acct.blob.core.windows.net/c/b?sv=2020&sig=${REDACTED_TOKEN}`,
  },
  {
    name: "url ?X-Amz-Signature",
    input: "https://b.s3.amazonaws.com/o?X-Amz-Signature=" + "a".repeat(64),
    output: `https://b.s3.amazonaws.com/o?X-Amz-Signature=${REDACTED_TOKEN}`,
  },
  {
    name: "url X-Amz-Credential",
    input: "https://b.s3.amazonaws.com/o?X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20260101%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=1",
    secret: "AKIAIOSFODNN7EXAMPLE",
    output: `https://b.s3.amazonaws.com/o?X-Amz-Credential=${REDACTED_TOKEN}&X-Amz-Date=1`,
  },
  {
    name: "url userinfo",
    input: "https://user:p4ssw0rd123@github.com/org/repo.git",
    output: `https://user:${REDACTED_PASSWORD}@github.com/org/repo.git`,
  },
  {
    // Used to come out as `[redacted:[redacted:password]@` — the URL rule
    // took the already-written marker for a user:password pair.
    name: "url userinfo token-only",
    input: "https://ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8@github.com/org/repo.git",
    output: `https://${REDACTED_TOKEN}@github.com/org/repo.git`,
  },
  {
    name: "url userinfo x-access-token",
    input: "https://x-access-token:" + "abcd".repeat(10) + "@github.com/o/r.git",
    output: `https://x-access-token:${REDACTED_PASSWORD}@github.com/o/r.git`,
  },
  { name: "pem rsa", input: "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nABCD\n-----END RSA PRIVATE KEY-----", output: REDACTED_KEY_BLOCK },
  { name: "pem openssh", input: "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXkt\n-----END OPENSSH PRIVATE KEY-----", output: REDACTED_KEY_BLOCK },
  { name: "pgp private block", input: "-----BEGIN PGP PRIVATE KEY BLOCK-----\nlQdGBF\n-----END PGP PRIVATE KEY BLOCK-----", output: REDACTED_KEY_BLOCK },
  { name: "env SECRET_KEY", input: "SECRET_KEY=django-insecure-abc123xyz", output: `SECRET_KEY=${REDACTED_VALUE}` },
  { name: "env DB_PASS", input: "DB_PASS=hunter2hunter2", output: `DB_PASS=${REDACTED_VALUE}` },
  { name: "env PGPASSWORD", input: "PGPASSWORD=hunter2hunter2", output: `PGPASSWORD=${REDACTED_VALUE}` },
  {
    name: "env DATABASE_URL",
    input: "DATABASE_URL=postgres://app:s3cretpass@db:5432/app",
    output: `DATABASE_URL=postgres://app:${REDACTED_PASSWORD}@db:5432/app`,
  },
  { name: "env STRIPE_KEY sk_live", input: "STRIPE_KEY=sk_live_" + K.slice(0, 24), output: `STRIPE_KEY=${REDACTED_TOKEN}` },
  { name: "stripe bare sk_live", input: "sk_live_" + K.slice(0, 24), output: REDACTED_TOKEN },
  { name: "stripe bare rk_live", input: "rk_live_" + K.slice(0, 24), output: REDACTED_TOKEN },
  { name: "env ENCRYPTION_KEY", input: "ENCRYPTION_KEY=" + K.slice(0, 32), output: `ENCRYPTION_KEY=${REDACTED_VALUE}` },
  { name: "env SIGNING_KEY", input: "SIGNING_KEY=" + K.slice(0, 32), output: `SIGNING_KEY=${REDACTED_VALUE}` },
  { name: "env JWT_SECRET", input: "JWT_SECRET=" + K.slice(0, 32), output: `JWT_SECRET=${REDACTED_VALUE}` },
  { name: "env SENTRY_DSN", input: "SENTRY_DSN=https://abc123def456@o1.ingest.sentry.io/1", output: `SENTRY_DSN=${REDACTED_VALUE}` },
  { name: "env short password 6", input: "PASSWORD=abc123", output: `PASSWORD=${REDACTED_VALUE}` },
  { name: "env numeric PIN", input: "PASSWORD=1234", output: `PASSWORD=${REDACTED_VALUE}` },
  { name: "env numeric secret", input: "API_SECRET=12345678901234567890", output: `API_SECRET=${REDACTED_VALUE}` },
  {
    name: "env SLACK_WEBHOOK",
    input: "SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T000/B000/" + K.slice(0, 24),
    output: `SLACK_WEBHOOK_URL=https://hooks.slack.com/services/${REDACTED_TOKEN}`,
  },
  {
    name: "discord webhook",
    input: "https://discord.com/api/webhooks/123456789012345678/" + K.slice(0, 40),
    output: `https://discord.com/api/webhooks/123456789012345678/${REDACTED_TOKEN}`,
  },
  { name: "slack xoxb", input: "xoxb-1234567890-" + K.slice(0, 24), output: REDACTED_TOKEN },
  { name: "google AIza", input: "AIza" + K.slice(0, 35), output: REDACTED_TOKEN },
  { name: "npm token", input: "//registry.npmjs.org/:_authToken=npm_" + K.slice(0, 36), output: `//registry.npmjs.org/:_authToken=${REDACTED_TOKEN}` },
  { name: "npm _authToken no prefix", input: "//registry.npmjs.org/:_authToken=" + K.slice(0, 36), output: `//registry.npmjs.org/:_authToken=${REDACTED_VALUE}` },
  {
    name: "cookie session",
    input: "Cookie: session=" + K.slice(0, 40) + "; other=1",
    output: `Cookie: session=${REDACTED_VALUE}; other=${REDACTED_VALUE}`,
  },
  {
    name: "set-cookie",
    input: "Set-Cookie: sessionid=" + K.slice(0, 40) + "; Path=/",
    output: `Set-Cookie: sessionid=${REDACTED_VALUE}; Path=/`,
  },
  {
    name: "cookie header in a JSON headers object",
    input: '{"Cookie": "a=' + K.slice(0, 20) + '; b=' + K.slice(20, 40) + '"}',
    output: `{"Cookie": "a=${REDACTED_VALUE}; b=${REDACTED_VALUE}"}`,
  },
  { name: "curl -u", input: "curl -u admin:S3cretPassw0rd https://api", output: `curl -u admin:${REDACTED_PASSWORD} https://api` },
  { name: "curl -H api-key", input: "curl -H 'X-API-Key: " + K.slice(0, 32) + "' https://x", secret: K.slice(0, 32) },
  { name: "json password", input: '{"password": "correct horse battery"}', output: `{"password": "${REDACTED_VALUE}"}` },
  { name: "json apiKey camel", input: '{"apiKey": "' + K.slice(0, 32) + '"}', output: `{"apiKey": "${REDACTED_VALUE}"}` },
  { name: "json accessToken camel", input: '{"accessToken": "' + K.slice(0, 32) + '"}', output: `{"accessToken": "${REDACTED_VALUE}"}` },
  { name: "json clientSecret camel", input: '{"clientSecret": "' + K.slice(0, 32) + '"}', output: `{"clientSecret": "${REDACTED_VALUE}"}` },
  { name: "yaml password", input: "password: hunter2hunter2", output: `password: ${REDACTED_VALUE}` },
  { name: "sendgrid", input: "SG." + K.slice(0, 22) + "." + K.slice(0, 43), output: REDACTED_TOKEN },
  { name: "twilio SK", input: "SK" + "0123456789abcdef".repeat(2), output: REDACTED_TOKEN },
  { name: "discord bot token", input: ["MTIzNDU2Nzg5MDEyMzQ1Njc4", "GhIjKl", "MnOpQrStUvWxYz0123456789abcdefghijk"].join("."), output: REDACTED_TOKEN },
  {
    name: "azure client secret bare",
    input: "Q~abcdefghijklmnopqrstuvwxyz0123456789ABC",
    untouched: "a bare `Q~` is not the published shape — gitleaks azure-ad-client-secret has three characters and a digit before the `Q~` (next row)",
  },
  { name: "azure client secret, published shape", input: "secret is abc1Q~" + K.slice(0, 32), output: `secret is ${REDACTED_TOKEN}` },
  {
    name: "hex 64 bare (generic)",
    input: "a".repeat(32) + "0123456789abcdef0123456789abcdef",
    untouched: "a bare 64-hex run is a SHA-256 or a content hash far more often than a credential",
  },
  {
    name: "ssh private line split (per-line call)",
    input: "AAAAB3NzaC1yc2EAAAADAQABAAABAQ",
    untouched: "one base64 line of a key body has no shape; a line-at-a-time caller uses createLineRedactor, which holds the block until its END marker",
  },
  { name: "unicode key split", input: "ANTHROPIC_API_KEY=sk-ant-api03-ABCDEF", output: `ANTHROPIC_API_KEY=${REDACTED_VALUE}` },
  { name: "key via --api-key flag", input: "cmd --api-key " + K.slice(0, 32), output: `cmd --api-key ${REDACTED_VALUE}` },
  { name: "key via --token flag", input: "cmd --token " + K.slice(0, 32), output: `cmd --token ${REDACTED_VALUE}` },
  { name: "key via --password= flag", input: "mysql --password=hunter2 -h db", output: `mysql --password=${REDACTED_VALUE} -h db` },
  {
    name: "env with export and quotes",
    input: "export GITHUB_TOKEN='ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'",
    output: `export GITHUB_TOKEN='${REDACTED_TOKEN}'`,
  },
  {
    name: "key in markdown backticks",
    input: "`ANTHROPIC_API_KEY`=`sk-ant-api03-" + K.slice(0, 40) + "`",
    output: "`ANTHROPIC_API_KEY`=`" + REDACTED_TOKEN + "`",
  },
  {
    name: "base64 'Basic'",
    input: "Authorization: Basic " + Buffer.from("user:p4ssw0rd123").toString("base64"),
    output: `Authorization: Basic ${REDACTED_TOKEN}`,
  },
  { name: "gitlab glpat", input: "glpat-" + K.slice(0, 20), output: REDACTED_TOKEN },
  { name: "heroku api key uuid", input: "HEROKU_API_KEY=12345678-1234-1234-1234-123456789abc", output: `HEROKU_API_KEY=${REDACTED_VALUE}` },
  {
    name: "kubernetes token",
    input: "token: eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMyJ9.eyJpc3MiOiJrdWJlcm5ldGVzL3NlcnZpY2VhY2NvdW50In0.abcdefghijklmnop",
    output: `token: ${REDACTED_TOKEN}`,
  },
  { name: "vault token", input: "VAULT_TOKEN=hvs." + K.slice(0, 24), output: `VAULT_TOKEN=${REDACTED_TOKEN}` },
  { name: "vault bare", input: "hvs." + K.slice(0, 24), output: REDACTED_TOKEN },
  { name: "shopify shpat", input: "shpat_" + "0123456789abcdef".repeat(2), output: REDACTED_TOKEN },
  { name: "shopify shpss", input: "shpss_" + "0123456789abcdef".repeat(2), output: REDACTED_TOKEN },
  {
    name: "age/ssh key value no name",
    input: "secret=abc",
    untouched: "three characters behind a non-password key are under the floor that keeps `token=abc` style identifiers readable",
  },
];

describe("redactSecrets — probe table", () => {
  for (const c of PROBE) {
    if (c.untouched !== undefined) {
      it(`leaves alone: ${c.name} (${c.untouched})`, () => {
        expect(redactSecrets(c.input)).toBe(c.input);
      });
      continue;
    }
    it(`redacts: ${c.name}`, () => {
      const out = redactSecrets(c.input);
      expect(out).not.toBe(c.input);
      expect(out).not.toContain(c.secret ?? c.input);
      expect(out).toContain("[redacted:");
      if (c.output !== undefined) expect(out).toBe(c.output);
      // Idempotent, and never a marker inside a marker.
      expect(redactSecrets(out)).toBe(out);
      expect(out).not.toMatch(/\[redacted:[^\]]*\[redacted:/);
    });
  }

  it("runs every probe row", () => {
    // The probe script has 68 rows; the table carries them all plus the
    // contextual and published-shape companions of its untouched rows.
    expect(PROBE.length).toBeGreaterThanOrEqual(68);
  });
});

describe("redactSecrets — prose and lookalikes stay readable", () => {
  const PROSE = [
    "Enter your password and press return",
    "The password reset email was sent",
    "Password required",
    "token expired, refreshing",
    "the secret sauce is caching",
    "Bearer tokens are passed in the Authorization header",
    "Bearer authentication is used by this API",
    "Basic internationalization support landed",
    "Cookie consent banner added",
    "Cookie: none",
    "pass the test suite before merging",
    "PASS src/redact.test.ts",
    "--- PASS: TestRedact (0.00s)",
    "PWD=/Users/someone/project",
    "OLDPWD=/Users/someone",
    "auth: true",
    '"auth": null',
    '"oauth": {"client_id": "abc"}',
    "ndx start --no-auth",
    "docker run -u 1000:1000 image",
    "git push -u origin main",
    "token=abc",
    "secret: 12345678",
    "sig: ok",
    "Session: 42",
    '"sessionId": "0b6e4e6a-5d2f-4a8c-9f1e-2c3d4e5f6a7b"',
    "--token-file ./token.txt",
    "--password-stdin",
    "The Twilio SKU is SK-200 and ships Monday",
    "SG. Smith reviewed the pull request.",
    "hvs. is a prefix, not a token",
  ];
  for (const line of PROSE) {
    it(`leaves "${line}"`, () => {
      expect(redactSecrets(line)).toBe(line);
    });
  }

  it("keeps a run record's session id so a resume can find it", () => {
    const record = JSON.stringify({
      session: { sessionId: "0b6e4e6a-5d2f-4a8c-9f1e-2c3d4e5f6a7b", resumedSession: true },
      tasksPerSession: 3,
    });
    expect(redactSecrets(record)).toBe(record);
  });

  it("does not take a JSON object as a value when the key is sensitive", () => {
    const text = '{"auth": {"token": "' + K.slice(0, 20) + '"}, "next": 1}';
    expect(redactSecrets(text)).toBe(`{"auth": {"token": "${REDACTED_VALUE}"}, "next": 1}`);
  });
});

describe("createLineRedactor — PGP blocks", () => {
  it("holds a PGP private key block until its END line", () => {
    const r = createLineRedactor();
    expect(r.push("-----BEGIN PGP PRIVATE KEY BLOCK-----")).toEqual([]);
    expect(r.push("lQdGBF")).toEqual([]);
    expect(r.push("-----END PGP PRIVATE KEY BLOCK-----")).toEqual([REDACTED_KEY_BLOCK]);
    expect(r.flush()).toEqual([]);
  });
});
