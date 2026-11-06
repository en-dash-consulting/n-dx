/**
 * `node dist/cli/credentials.js` — the credential store's spawnable entry.
 *
 * The orchestration tier (`packages/core/config.js`) may not import
 * llm-client, so it spawns this file to write the store:
 *
 *   set <name>         value read from stdin, never from argv
 *   set-helper <name>  a helper command's argv, as a JSON string array on stdin
 *   unset <name>
 *   test typesafe      one request with the resolved key: ok, rejected or
 *                      unreachable, with the fingerprint; never the key
 *   status [--json] [--project=<dir>] [--check]
 *                      source, backend and fingerprint; never the value. With
 *                      a project, each vendor's `llm.<vendor>.auth` mode and
 *                      the key it uses, read from that project's config. A
 *                      helper is named, and run only with --check.
 *
 * Names: `typesafe` and the vendor keys `claude`, `codex`, `google`.
 * Nothing this file prints contains a credential value.
 *
 * Exit codes: 0 done, 1 the operation failed, 2 usage error.
 */

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CREDENTIAL_ENV_VARS,
  credentialStatus,
  helperArgvError,
  interpreterHelperError,
  interpreterHelperPrefix,
  setCredential,
  setHelperCredential,
  unsetCredential,
  type CredentialStatus,
  type CredentialWriteOptions,
} from "../credential-store.js";
import { probeJevKey } from "../jev-client.js";
import { loadLLMConfig } from "../llm-config.js";
import type { LLMConfig } from "../llm-types.js";
import {
  KEYED_VENDORS,
  describeVendorAuth,
  resolveVendorAuth,
  vendorKeyEnv,
  type KeyedVendor,
  type VendorAuthDecision,
  type VendorKeySource,
} from "../vendor-auth.js";

/** Names this entry accepts. */
export const CLI_CREDENTIAL_NAMES: readonly string[] = ["typesafe", ...KEYED_VENDORS];

/** Starts `status`'s line naming why the store was not read; `ndx config` finds it by this. */
const STORE_PROBLEM_PREFIX = "Store not read: ";

const USAGE = [
  "Usage: credentials <command>",
  "",
  "  set <name>        store the value read from stdin",
  "  set-helper <name> store a helper command: its argv as a JSON string",
  "                    array on stdin, run without a shell when needed",
  "  unset <name>      remove a stored credential",
  "  test typesafe     make one request to prove the key (never prints it)",
  "  status [--json] [--project=<dir>] [--check]",
  "                    show where each credential resolves from; with a",
  "                    project, each vendor's auth mode and the key it uses;",
  "                    --check runs helpers to fingerprint their values",
  "",
  `Names: ${CLI_CREDENTIAL_NAMES.join(", ")}`,
].join("\n");

export interface CredentialsCliIo {
  /** The whole of stdin, or null when stdin is a terminal (no piped value). */
  readStdin: () => Promise<string | null>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Store options (tests point these at a temp ndx home). */
  store?: CredentialWriteOptions;
  /** The request `test` makes (tests inject a mock; no suite reaches TypeSafe). */
  fetchImpl?: typeof fetch;
}

/** One vendor's auth line for `status --project`, never the value. */
export interface VendorAuthStatus {
  vendor: KeyedVendor;
  auth: VendorAuthDecision["auth"];
  authSource: string;
  mode: VendorAuthDecision["mode"];
  /** Where the key the mode uses came from; null when it uses none. */
  keySource: VendorKeySource | null;
  storedKeyHeld: boolean;
  envVar: string;
  line: string;
}

/**
 * Each vendor's mode and key source under `config`, never a value. A helper
 * runs only when `store.runHelpers` is not false and the mode uses its key.
 */
export function vendorAuthStatuses(config: LLMConfig, store: CredentialWriteOptions = {}): VendorAuthStatus[] {
  return KEYED_VENDORS.map((vendor) => {
    const decision = resolveVendorAuth(vendor, config, store);
    const envVar = vendorKeyEnv(vendor, config);
    const used = decision.mode === "api" ? decision.key : undefined;
    return {
      vendor,
      auth: decision.auth,
      authSource: decision.authSource,
      mode: decision.mode,
      keySource: used?.source ?? null,
      storedKeyHeld: decision.storedKeyHeld,
      envVar,
      line: describeVendorAuth(decision, envVar, store.runHelpers !== false),
    };
  });
}

/** Run the CLI and return its exit code. */
export async function runCredentialsCli(argv: readonly string[], io: CredentialsCliIo): Promise<number> {
  const [command, ...rest] = argv;
  const store: CredentialWriteOptions = { warn: (m) => io.stderr(`${m}\n`), ...io.store };

  const usage = (message: string): number => {
    io.stderr(`${message}\n\n${USAGE}\n`);
    return 2;
  };
  const checkName = (name: string | undefined): string | null => {
    if (!name) return "Missing credential name.";
    if (!CLI_CREDENTIAL_NAMES.includes(name)) {
      return `Unknown credential name ${JSON.stringify(name)}.`;
    }
    return null;
  };

  try {
    switch (command) {
      case "set": {
        const [name, ...extra] = rest;
        const nameError = checkName(name);
        if (nameError) return usage(nameError);
        // Never echo `extra`: it is most likely the key itself.
        if (extra.length > 0) {
          return usage("A value on the command line is refused: it would land in shell history and the process list. Pipe it on stdin.");
        }
        const input = await io.readStdin();
        if (input === null) return usage("No value on stdin. Pipe the value in, e.g. `printf %s \"$KEY\" | credentials set typesafe`.");
        const value = input.replace(/\r?\n$/, "");
        if (value.trim().length === 0) {
          io.stderr("No value on stdin: nothing was stored.\n");
          return 1;
        }
        setCredential(name!, value, store);
        io.stdout(`Stored ${name}.\n`);
        return 0;
      }
      case "set-helper": {
        const [name, ...extra] = rest;
        const nameError = checkName(name);
        if (nameError) return usage(nameError);
        if (extra.length > 0) return usage("set-helper takes one name; the command's argv goes on stdin as JSON.");
        const input = await io.readStdin();
        if (input === null) return usage('No argv on stdin. Pipe a JSON string array, e.g. `echo \'["op","read","op://vault/item/field"]\' | credentials set-helper typesafe`.');
        let argv: unknown;
        try {
          argv = JSON.parse(input);
        } catch {
          return usage("The argv on stdin is not valid JSON: it must be a JSON array of strings.");
        }
        const argvError = helperArgvError(argv) ?? interpreterHelperError(argv as string[]);
        if (argvError) {
          io.stderr(`Refusing --helper: ${argvError}\n`);
          return 2;
        }
        setHelperCredential(name!, argv as string[], store);
        io.stdout(`Stored ${name}: helper (${(argv as string[])[0]}).\n`);
        const interpreted = interpreterHelperPrefix(argv as string[]);
        if (interpreted?.prefix) {
          io.stdout(
            `Note: agents can still run ${interpreted.interpreter} itself; only "${interpreted.prefix.join(" ")}" is denied to them.\n`,
          );
        }
        return 0;
      }
      case "unset": {
        const [name, ...extra] = rest;
        const nameError = checkName(name);
        if (nameError) return usage(nameError);
        if (extra.length > 0) return usage("unset takes one name.");
        const removed = unsetCredential(name!, store);
        io.stdout(removed ? `Removed ${name}.\n` : `${name} was not stored.\n`);
        return 0;
      }
      case "test": {
        const [name, ...extra] = rest;
        const nameError = checkName(name);
        if (nameError) return usage(nameError);
        if (name !== "typesafe") return usage(`test supports typesafe only; ${name} has no key check.`);
        if (extra.length > 0) return usage("test takes one name.");
        const probe = await probeJevKey({ ndxHome: store.ndxHome, ...(io.fetchImpl ? { fetchImpl: io.fetchImpl } : {}) });
        const print = (text: string) => (probe.outcome === "ok" ? io.stdout(text) : io.stderr(text));
        const fp = probe.fingerprint ? ` (fingerprint ${probe.fingerprint})` : "";
        switch (probe.outcome) {
          case "ok":
            print(`typesafe: ok${fp}\n`);
            return 0;
          case "rejected":
            print(`typesafe: rejected${fp}: TypeSafe refused the key (HTTP ${probe.status}). Store a valid one: ndx config credentials.typesafe\n`);
            return 1;
          case "unreachable":
            print(`typesafe: unreachable${fp}: ${probe.detail ?? "no answer"}. The key was not judged.\n`);
            return 1;
          default:
            print("typesafe: no key. Store one: ndx config credentials.typesafe\n");
            return 1;
        }
      }
      case "status": {
        const json = rest.includes("--json");
        const check = rest.includes("--check");
        const projectArg = rest.find((a) => a.startsWith("--project="));
        const unknown = rest.filter((a) => a !== "--json" && a !== "--check" && a !== projectArg);
        if (unknown.length > 0) return usage(`Unknown argument for status.`);
        const project = projectArg?.slice("--project=".length);
        if (projectArg !== undefined && !project) return usage("--project needs a directory.");
        const config = project ? await loadLLMConfig(resolve(project)) : undefined;
        // The output reports a store that was not read (storeProblem), so that
        // warning is held back; any other (a failed helper) still goes out.
        const warnings: string[] = [];
        const held = { ...store, warn: (m: string) => warnings.push(m) };
        const statuses = CLI_CREDENTIAL_NAMES.map((name) =>
          credentialStatus(name, {
            ...held,
            check,
            // google's variable is the project's llm.google.apiKeyEnv when set.
            ...(config && name === "google" ? { envVar: vendorKeyEnv("google", config) } : {}),
          }),
        );
        // Without --check no helper runs, for the vendor lines either.
        const vendors = config ? vendorAuthStatuses(config, { ...held, runHelpers: check }) : undefined;
        const storeProblem = statuses[0]?.storeProblem;
        for (const warning of warnings) if (warning !== storeProblem) store.warn!(warning);
        if (json) {
          io.stdout(`${JSON.stringify(vendors ? { credentials: statuses, vendors } : statuses, null, 2)}\n`);
        } else {
          io.stdout(formatStatus(statuses) + (vendors ? formatVendors(vendors) : ""));
        }
        return 0;
      }
      case undefined:
      case "help":
      case "--help":
      case "-h":
        io.stdout(`${USAGE}\n`);
        return command === undefined ? 2 : 0;
      default:
        return usage(`Unknown command ${JSON.stringify(command)}.`);
    }
  } catch (err) {
    // Store errors name paths and versions, never a value.
    io.stderr(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

function formatStatus(statuses: CredentialStatus[]): string {
  const lines = statuses.map((s) => {
    const helper = `credential store, helper (${s.helperCommand})`;
    if (s.helperResult === "failed") return `${s.name}: ${helper}: failed, so not set`;
    if (s.source === null) return s.storeProblem ? `${s.name}: unknown, the store was not read` : `${s.name}: not set`;
    if (s.helperResult === "not-run") return `${s.name}: ${helper}, not run (--check runs it)`;
    const where =
      s.source === "env"
        ? `environment (${s.envVar ?? CREDENTIAL_ENV_VARS[s.name]})`
        : s.source === "helper"
          ? helper
          : `credential store (${s.backend})`;
    return `${s.name}: ${where}, fingerprint ${s.fingerprint}`;
  });
  const storePath = statuses[0]?.storePath;
  const problem = statuses[0]?.storeProblem;
  return (
    `${lines.join("\n")}\n${storePath ? `Store: ${storePath}\n` : ""}` +
    (problem ? `${STORE_PROBLEM_PREFIX}${problem}\n` : "")
  );
}

function formatVendors(vendors: VendorAuthStatus[]): string {
  return `\nAuth (llm.<vendor>.auth: cli, api or auto)\n${vendors.map((v) => v.line).join("\n")}\n`;
}

async function readProcessStdin(): Promise<string | null> {
  if (process.stdin.isTTY) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    // argv[1] is not a file (a REPL or `node -e`): not this script.
    return false;
  }
}

if (invokedDirectly()) {
  const code = await runCredentialsCli(process.argv.slice(2), {
    readStdin: readProcessStdin,
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
  });
  process.exitCode = code;
}
