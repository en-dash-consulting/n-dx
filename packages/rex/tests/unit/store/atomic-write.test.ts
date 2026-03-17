import { describe, it, expect, afterEach } from "vitest";
import { readFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { atomicWrite, atomicWriteJSON } from "../../../src/store/atomic-write.js";

describe("atomicWrite", () => {
  const tmpDir = join(tmpdir(), `rex-atomic-write-str-test-${process.pid}`);
  const filePath = join(tmpDir, "test.txt");

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes a pre-serialized string atomically", async () => {
    await mkdir(tmpDir, { recursive: true });
    await atomicWrite(filePath, '{"custom":true}');

    const raw = await readFile(filePath, "utf-8");
    expect(raw).toBe('{"custom":true}');
  });
});

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

  it("uses custom serializer when provided", async () => {
    await mkdir(tmpDir, { recursive: true });
    const customSerializer = (d: unknown) => `CUSTOM:${JSON.stringify(d)}`;
    await atomicWriteJSON(filePath, { a: 1 }, customSerializer);

    const raw = await readFile(filePath, "utf-8");
    expect(raw).toBe('CUSTOM:{"a":1}');
  });

  it("does not leave temp files on success", async () => {
    await mkdir(tmpDir, { recursive: true });
    await atomicWriteJSON(filePath, { ok: true });

    const { readdirSync } = await import("node:fs");
    const files = readdirSync(tmpDir);
    expect(files).toEqual(["test.json"]);
  });
});
