import { describe, it, expect, afterEach } from "vitest";
import { readFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  atomicWrite,
  atomicWriteJSON,
  atomicWriteTempPath,
  isAtomicWriteTempPath,
} from "../../../src/store/atomic-write.js";

describe("atomicWriteTempPath / isAtomicWriteTempPath", () => {
  // The matcher and the builder are the two halves of one contract: a reader
  // walking the tree (snapshotPRDTree) skips what a writer is mid-rename. If
  // they drift, the snapshot silently copies temp files again — or worse,
  // aborts on one that vanished. This asserts they agree.
  it("recognises the path the builder produces", () => {
    expect(isAtomicWriteTempPath(atomicWriteTempPath("/tree/epic/index.md"))).toBe(true);
  });

  it("keeps the temp file a sibling of its target", () => {
    const tmp = atomicWriteTempPath("/tree/epic/index.md");
    expect(tmp.startsWith("/tree/epic/index.md.")).toBe(true);
    expect(tmp.endsWith(".tmp")).toBe(true);
  });

  it("gives each call a distinct name", () => {
    const a = atomicWriteTempPath("/tree/epic/index.md");
    const b = atomicWriteTempPath("/tree/epic/index.md");
    expect(a).not.toBe(b);
  });

  it("does not treat real PRD content as a temp file", () => {
    expect(isAtomicWriteTempPath("/tree/epic/index.md")).toBe(false);
    expect(isAtomicWriteTempPath("/tree/epic/.tree-meta.json")).toBe(false);
    // A user-authored file that merely ends in .tmp is content, not in-flight.
    expect(isAtomicWriteTempPath("/tree/epic/notes.tmp")).toBe(false);
    expect(isAtomicWriteTempPath("/tree/epic/index.md.1234.tmp")).toBe(false);
  });
});

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
