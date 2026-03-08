import { describe, it, expect, afterEach } from "vitest";
import { readFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { atomicWriteJSON } from "../../../src/store/atomic-write.js";

describe("atomicWriteJSON", () => {
  const tmpDir = join(tmpdir(), `rex-atomic-write-test-${process.pid}`);
  const filePath = join(tmpDir, "test.json");

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes valid JSON that can be read back", async () => {
    await mkdir(tmpDir, { recursive: true });
    const data = { proposals: [{ title: "Test" }], count: 42 };
    await atomicWriteJSON(filePath, data);

    const raw = await readFile(filePath, "utf-8");
    expect(JSON.parse(raw)).toEqual(data);
  });

  it("overwrites existing file atomically", async () => {
    await mkdir(tmpDir, { recursive: true });
    await atomicWriteJSON(filePath, { version: 1 });
    await atomicWriteJSON(filePath, { version: 2 });

    const raw = await readFile(filePath, "utf-8");
    expect(JSON.parse(raw)).toEqual({ version: 2 });
  });

  it("does not leave temp files on success", async () => {
    await mkdir(tmpDir, { recursive: true });
    await atomicWriteJSON(filePath, { ok: true });

    const { readdirSync } = await import("node:fs");
    const files = readdirSync(tmpDir);
    expect(files).toEqual(["test.json"]);
  });
});
