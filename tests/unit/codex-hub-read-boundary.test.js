import { expect, it } from "vitest";
import { readBoundaryVerdict } from "../../scripts/probe-codex-hub-read-boundary.mjs";

const canary = "/fixture/repository/canary";
const verdict = (result) => readBoundaryVerdict(result, canary);

const denied = {
  status: 0,
  stdout: "PROBE_STARTED\nDISPOSABLE_SNAPSHOT\npositive=0\nnegative=1\n",
  stderr: `cat: ${canary}: Operation not permitted\n`,
};

it("recognizes only native denial with a working positive control", () => {
  expect(verdict(denied)).toBe("native-read-denied");
});

it.each([
  { status: 71, stdout: "", stderr: "sandbox_apply: Operation not permitted" },
  { ...denied, error: new Error("spawn ENOENT") },
  { ...denied, signal: "SIGTERM" },
  { ...denied, stdout: denied.stdout.replace("PROBE_STARTED", "") },
])("does not treat startup failure or cancellation as confinement: %j", (result) => {
  expect(verdict(result)).toBe("unavailable");
});

it("rejects a sandbox that denies the permitted snapshot too", () => {
  expect(verdict({ ...denied, stdout: denied.stdout.replace("positive=0", "positive=1") }))
    .toBe("invalid-positive-control");
});

it.each([
  denied.stdout.replace("negative=1", "negative=0"),
  denied.stdout + "DISPOSABLE_REPOSITORY_CANARY\n",
])("reports repository reads even when stderr also contains a denial", (stdout) => {
  expect(verdict({ ...denied, stdout })).toBe("repository-readable");
});

it("does not mistake a missing file for a denied read", () => {
  expect(verdict({ ...denied, stderr: "No such file or directory" })).toBe("inconclusive");
});

it("requires the permission error to identify the repository canary", () => {
  const stderr = `startup: Permission denied\ncat: ${canary}: No such file or directory\n`;
  expect(verdict({ ...denied, stderr })).toBe("inconclusive");
});
