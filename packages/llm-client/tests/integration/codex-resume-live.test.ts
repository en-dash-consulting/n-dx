/** Opt-in, billed real-model evidence; never counted as mocked protocol coverage. */
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { execFileSyncCli } from "../../src/exec.js";
import { codexSessionDriver } from "../../src/vendor-session-driver.js";
import { compileCodexPolicyFlags } from "../../src/codex-cli-provider.js";
import { DEFAULT_EXECUTION_POLICY } from "../../src/runtime-contract.js";

it.skipIf(process.env.NDX_CODEX_RESUME_LIVE !== "1")(
  "real Codex retains the work thread and its marker through retry and self-review turns (opt-in)", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-resume-live-"));
    const home = join(dir, "home");
    mkdirSync(home);
    // Explicit fixture credentials only; never copy the operator's auth files.
    const env = { PATH: process.env.PATH, HOME: home, CODEX_HOME: home,
      CODEX_API_KEY: process.env.NDX_CODEX_RESUME_API_KEY };
    const binary = process.env.NDX_CODEX_RESUME_BINARY ?? "codex";
    const model = process.env.NDX_CODEX_RESUME_MODEL ?? "gpt-6-astra";
    try {
      const capability = codexSessionDriver.probeResume!(binary, env, dir);
      expect(capability.supported, `${capability.version ?? "unavailable"}: ${capability.reason}`).toBe(true);
      const marker = randomUUID();
      let workId: string | undefined;
      for (const prompt of [
        `Remember ${marker}. Reply with that marker only. Do not use tools.`,
        "Continue the prior work: repeat the marker from the previous turn only. Do not use tools.",
        "Self-review the previous answers: repeat the original marker only. Do not use tools.",
      ]) {
        const spec = codexSessionDriver.turnSpawn({ systemPrompt: "", prompt, model,
          ...(workId ? { resume: { sessionId: workId } } : {}), codex: {
            configFlags: ["--ignore-user-config", "--ignore-rules", "-c", 'cli_auth_credentials_store="file"', "-c", "features.apps=false"],
            policyFlags: compileCodexPolicyFlags(DEFAULT_EXECUTION_POLICY),
            resumePolicyFlags: compileCodexPolicyFlags(DEFAULT_EXECUTION_POLICY, { resume: true }),
          } });
        if (workId) expect(spec.args.slice(0, 2)).toEqual(["exec", "resume"]);
        let output: string;
        try {
          output = execFileSyncCli(binary, spec.args, { cwd: dir, env, input: spec.stdin,
            timeout: 15_000, killSignal: "SIGKILL", stdio: ["pipe", "pipe", "pipe"] }).toString();
        } catch {
          throw new Error(`Live ${capability.version} turn did not complete; model access/session continuity remains unverified`);
        }
        const events = output.trim().split("\n").map(line => JSON.parse(line));
        const id = events.map(event => codexSessionDriver.extractSessionId(event)).find(Boolean);
        expect(id).toBeTruthy();
        if (workId) expect(id).toBe(workId);
        workId = id;
        expect(events.some(event => event.type === "turn.completed")).toBe(true);
        expect(events.some(event => event.item?.type === "agent_message" && event.item.text?.includes(marker))).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000,
);
