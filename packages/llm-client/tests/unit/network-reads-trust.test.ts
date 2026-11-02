import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectRepoExecutionConfig, evaluateRepoTrust, recordRepoTrust, repoTrustStateOf } from "../../src/repo-trust.js";

/**
 * `web.sidecarGithubReads: true` lets the Sidecar run gh with the user's login
 * without a network-read card, so a repository that ships it is asking to
 * widen what n-dx runs: a trust finding, covered by the digest. `false` only
 * tightens and changes nothing.
 */

let repo: string;
let home: string;

const writeProject = (data: unknown) => writeFileSync(join(repo, ".n-dx.json"), JSON.stringify(data));

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "ndx-network-reads-repo-"));
  home = mkdtempSync(join(tmpdir(), "ndx-network-reads-home-"));
  vi.stubEnv("NDX_HOME", home);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe("web.sidecarGithubReads in the project config", () => {
  it("is a warning finding, so the repository reads as untrusted until accepted", () => {
    writeProject({ web: { sidecarGithubReads: true } });
    const ev = evaluateRepoTrust(repo);
    expect(ev.state).toBe("untrusted");
    expect(ev.findings.find((f) => f.code === "network-reads")).toMatchObject({
      severity: "warning",
      values: ["web.sidecarGithubReads = true"],
    });
    recordRepoTrust(repo);
    expect(evaluateRepoTrust(repo).state).toBe("trusted");
  });

  it("moves the digest, so turning it on after trust asks again", () => {
    writeProject({ web: {} });
    const before = collectRepoExecutionConfig(repo).digest;
    writeProject({ web: { sidecarGithubReads: true } });
    expect(collectRepoExecutionConfig(repo).digest).not.toBe(before);
  });

  it("reports the same state through repoTrustStateOf as the full evaluation", () => {
    writeProject({ web: { sidecarGithubReads: false } });
    expect(repoTrustStateOf(repo)).toBe("baseline");
    writeProject({ web: { sidecarGithubReads: true } });
    expect(repoTrustStateOf(repo)).toBe("untrusted");
    recordRepoTrust(repo);
    expect(repoTrustStateOf(repo)).toBe("trusted");
  });

  it("leaves the digest and state alone when false", () => {
    writeProject({ web: {} });
    const before = collectRepoExecutionConfig(repo).digest;
    writeProject({ web: { sidecarGithubReads: false } });
    expect(collectRepoExecutionConfig(repo).digest).toBe(before);
    expect(evaluateRepoTrust(repo).state).toBe("baseline");
  });
});
