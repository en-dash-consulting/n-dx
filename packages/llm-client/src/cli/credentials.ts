/**
 * `node dist/cli/credentials.js` — the credential store's spawnable entry.
 *
 * The orchestration tier (`packages/core/config.js`) may not import
 * llm-client, so it spawns this file to write the store:
 *
 *   set <name>         value read from stdin, never from argv
 *   unset <name>
 *   status [--json] [--project=<dir>]
 *                      source, backend and fingerprint; never the value. With
 *                      a project, each vendor's `llm.<vendor>.auth` mode and
 *                      the key it uses, read from that project's config.
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
  setCredential,
  unsetCredential,
  type CredentialStatus,
  type CredentialWriteOptions,
} from "../credential-store.js";
import { loadLLMConfig } from "../llm-config.js";
import type { LLMConfig } from "../llm-types.js";
import {
  KEYED_VENDORS,
  describeVendorAuth,
  resolveVendorAuth,
  vendorKeyEnv,
  type KeyedVendor,
  type VendorAuthDecision,
} from "../vendor-auth.js";

/** Names this entry accepts. */
export const CLI_CREDENTIAL_NAMES: readonly string[] = ["typesafe", ...KEYED_VENDORS];

const USAGE = [
  "Usage: credentials <command>",
  "",
  "  set <name>        store the value read from stdin",
  "  unset <name>      remove a stored credential",
  "  status [--json] [--project=<dir>]",
  "                    show where each credential resolves from; with a",
  "                    project, each vendor's auth mode and the key it uses",
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
}

/** One vendor's auth line for `status --project`, never the value. */
export interface VendorAuthStatus {
  vendor: KeyedVendor;
  auth: VendorAuthDecision["auth"];
  authSource: string;
  mode: VendorAuthDecision["mode"];
  /** Where the key the mode uses came from; null when it uses none. */
  keySource: "config" | "env" | "file" | null;
  storedKeyHeld: boolean;
  envVar: string;
  line: string;
}

/** Each vendor's mode and key source under `config`, never a value. */
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
      line: describeVendorAuth(decision, envVar),
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
      case "unset": {
        const [name, ...extra] = rest;
        const nameError = checkName(name);
        if (nameError) return usage(nameError);
        if (extra.length > 0) return usage("unset takes one name.");
        const removed = unsetCredential(name!, store);
        io.stdout(removed ? `Removed ${name}.\n` : `${name} was not stored.\n`);
        return 0;
      }
      case "status": {
        const json = rest.includes("--json");
        const projectArg = rest.find((a) => a.startsWith("--project="));
        const unknown = rest.filter((a) => a !== "--json" && a !== projectArg);
        if (unknown.length > 0) return usage(`Unknown argument for status.`);
        const project = projectArg?.slice("--project=".length);
        if (projectArg !== undefined && !project) return usage("--project needs a directory.");
        const config = project ? await loadLLMConfig(resolve(project)) : undefined;
        const statuses = CLI_CREDENTIAL_NAMES.map((name) =>
          credentialStatus(name, {
            ...store,
            // google's variable is the project's llm.google.apiKeyEnv when set.
            ...(config && name === "google" ? { envVar: vendorKeyEnv("google", config) } : {}),
          }),
        );
        const vendors = config ? vendorAuthStatuses(config, store) : undefined;
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
    if (s.source === null) return `${s.name}: not set`;
    const where = s.source === "env" ? `environment (${s.envVar ?? CREDENTIAL_ENV_VARS[s.name]})` : `credential store (${s.backend})`;
    return `${s.name}: ${where}, fingerprint ${s.fingerprint}`;
  });
  const storePath = statuses[0]?.storePath;
  return `${lines.join("\n")}\n${storePath ? `Store: ${storePath}\n` : ""}`;
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
