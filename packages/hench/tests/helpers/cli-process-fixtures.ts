import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

/**
 * Split a command line built by `buildWindowsCliCommandLine` back into its
 * tokens — the binary first, then the argv.
 *
 * The inverse of `quoteWindowsToken`: every argument is wrapped in `"…"`, an
 * embedded quote is written `""`, and backslashes are doubled only where they
 * precede a quote (or the closing quote). The binary may be bare.
 *
 * @internal Exported for testing.
 */
export function decodeWindowsCommandLine(line: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    while (i < n && line[i] === " ") i++;
    if (i >= n) break;
    if (line[i] !== '"') {
      const start = i;
      while (i < n && line[i] !== " ") i++;
      tokens.push(line.slice(start, i));
      continue;
    }
    i++; // opening quote
    let token = "";
    while (i < n) {
      let slashes = 0;
      while (i < n && line[i] === "\\") {
        slashes++;
        i++;
      }
      if (i < n && line[i] === '"') {
        token += "\\".repeat(slashes / 2);
        if (line[i + 1] === '"') {
          token += '"'; // `""` is an embedded quote
          i += 2;
          continue;
        }
        i++; // closing quote
        break;
      }
      token += "\\".repeat(slashes);
      if (i < n) token += line[i++];
    }
    tokens.push(token);
  }
  return tokens;
}

/** config/read never consumes a model turn. The native protocol is covered by
 * the dedicated scratch tests; loop fixtures retain the compiler's temp set.
 */
export function configReadChild(args: string[]): EventEmitter {
  const proc = Object.assign(new EventEmitter(), {
    pid: undefined, exitCode: null as number | null, signalCode: null,
    stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: () => true,
  });
  proc.stdin.on("finish", () => {
    proc.exitCode = 0;
    proc.emit("close", 0);
  });
  const set: Record<string, string> = {};
  const mcp_servers: Record<string, Record<string, unknown>> = {};
  const features: Record<string, boolean> = {};
  for (const arg of args) {
    const match = /^shell_environment_policy\.set\.(TMPDIR|TMP|TEMP)=(.*)$/.exec(arg);
    if (match) set[match[1]] = JSON.parse(match[2]);
    const mcp = /^mcp_servers\.([A-Za-z0-9_-]+)\.([a-z_]+)=(.*)$/.exec(arg);
    if (mcp) (mcp_servers[mcp[1]] ??= {})[mcp[2]] = JSON.parse(mcp[3]);
    const feature = /^features\.([a-z_]+)=(true|false)$/.exec(arg);
    if (feature) features[feature[1]] = JSON.parse(feature[2]);
  }
  proc.stdin.on("data", chunk => {
    const message = JSON.parse(String(chunk));
    if (message.id) queueMicrotask(() => proc.stdout.write(JSON.stringify({ id: message.id,
      result: message.method === "initialize" ? {} : { config: { shell_environment_policy: { set }, mcp_servers, features } },
    }) + "\n"));
  });
  return proc;
}
