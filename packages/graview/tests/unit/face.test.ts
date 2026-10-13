import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FACE_FILENAME, runningFace } from "../../src/face.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function graviewDir(record?: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "ndx-face-"));
  dirs.push(dir);
  if (record !== undefined) writeFileSync(join(dir, FACE_FILENAME), typeof record === "string" ? record : JSON.stringify(record));
  return dir;
}

describe("runningFace", () => {
  it("reads the face's record while its process lives", () => {
    const dir = graviewDir({ url: "http://localhost:5189/", pid: process.pid, startedAt: "2026-10-13T00:00:00.000Z" });
    expect(runningFace(dir)).toEqual({ url: "http://localhost:5189/", pid: process.pid, startedAt: "2026-10-13T00:00:00.000Z" });
  });

  it("is undefined with no record, a dead process, or a malformed one", () => {
    expect(runningFace(graviewDir())).toBeUndefined();
    expect(runningFace(graviewDir({ url: "http://localhost:5188/", pid: 4242 }), () => false)).toBeUndefined();
    expect(runningFace(graviewDir("{not json"))).toBeUndefined();
    expect(runningFace(graviewDir({ url: "javascript:alert(1)", pid: process.pid }))).toBeUndefined();
  });
});
