/**
 * Images attached to a change live in the change's own folder: attachImages
 * writes them there under the PRD lock, listAttachments finds them again, and
 * the writer carries them along when the change's folder moves.
 *
 * Real folder tree, real writer.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { cmdAddChange } from "../../src/cli/commands/add-change.js";
import { DEFAULT_CONFIG } from "../../src/schema/index.js";
import { SCHEMA_VERSION_V2 } from "../../src/schema/v2.js";
import { loadPrdModel } from "../../src/store/prd-model-reader.js";
import { writePrdModel } from "../../src/store/prd-model-writer.js";
import { withPrdModelTransaction } from "../../src/store/prd-model-transaction.js";
import { withLock } from "../../src/store/file-lock.js";
import { prdLockPath } from "../../src/store/paths.js";
import {
  AttachmentError,
  attachImages,
  attachmentFileName,
  listAttachments,
  matchesImageSignature,
  MAX_ATTACHMENT_BYTES,
  type AttachmentImage,
} from "../../src/core/change-attachments.js";

const quiet = { env: {}, warn: () => {} };

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 9, 9]);
const png = (name: string): AttachmentImage => ({ name, mediaType: "image/png", data: PNG });

describe("change attachments", () => {
  let dir: string;
  let rexDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    dir = realpathSync.native(await mkdtemp(join(tmpdir(), "rex-attach-")));
    rexDir = join(dir, ".rex");
    await mkdir(rexDir);
    await withLock(prdLockPath(rexDir), () =>
      writePrdModel(rexDir, { layout: "v2", schema: SCHEMA_VERSION_V2, title: "Attach", tree: { product: [], changes: [] }, warnings: [] }),
    );
    await writeFile(join(rexDir, "config.json"), JSON.stringify(DEFAULT_CONFIG("attach")));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await rm(dir, { recursive: true, force: true });
  });

  const tree = async () => (await loadPrdModel(rexDir, quiet)).tree;

  async function addChange(title: string): Promise<string> {
    await cmdAddChange(dir, undefined, { title });
    return (await tree()).changes.find((c) => c.title === title)!.id;
  }

  it("writes images into the change's folder and lists them back", async () => {
    const id = await addChange("Redo the header");
    const written = await attachImages(rexDir, id, [png("Header Mock.PNG"), { name: "photo.jpeg", mediaType: "image/jpeg", data: JPEG }]);

    expect(written.map((p) => basename(p))).toEqual(["header-mock.png", "photo.jpg"]);
    const folder = dirname(written[0]);
    expect(await readdir(folder)).toEqual(expect.arrayContaining(["index.md", "header-mock.png", "photo.jpg"]));
    expect(new Uint8Array(await readFile(written[0]))).toEqual(PNG);

    expect(await listAttachments(rexDir, [id, "no-such-id"])).toEqual([{ id, files: [...written].sort() }]);
    // The tree reads as before: the images are not nodes and raise no warning.
    const model = await loadPrdModel(rexDir, quiet);
    expect(model.warnings).toEqual([]);
    expect(model.tree.changes).toHaveLength(1);
  });

  it("never overwrites: a second image of the same name gets a counter", async () => {
    const id = await addChange("Two shots");
    await attachImages(rexDir, id, [png("shot.png")]);
    const second = await attachImages(rexDir, id, [png("shot.png"), png("shot.png")]);
    expect(second.map((p) => basename(p))).toEqual(["shot-2.png", "shot-3.png"]);
  });

  it("refuses, writing nothing, when one image is not what it claims", async () => {
    const id = await addChange("Bad file");
    const before = (await listAttachments(rexDir, [id])).length;
    await expect(
      attachImages(rexDir, id, [png("ok.png"), { name: "fake.png", mediaType: "image/png", data: JPEG }]),
    ).rejects.toThrow(AttachmentError);
    await expect(attachImages(rexDir, id, [{ name: "doc.svg", mediaType: "image/svg+xml", data: PNG }])).rejects.toThrow(/not supported/);
    await expect(
      attachImages(rexDir, id, [{ name: "big.png", mediaType: "image/png", data: new Uint8Array(MAX_ATTACHMENT_BYTES + 1).fill(0x89) }]),
    ).rejects.toThrow(/limit/);
    expect((await listAttachments(rexDir, [id])).length).toBe(before);
  });

  it("refuses a node with no folder of its own", async () => {
    await expect(attachImages(rexDir, "missing", [png("a.png")])).rejects.toThrow(/no folder/);
  });

  it("keeps the images with the change when its folder moves", async () => {
    const outer = await addChange("Outer change");
    const inner = await addChange("Inner change");
    const [image] = await attachImages(rexDir, inner, [png("diagram.png")]);

    await withPrdModelTransaction(rexDir, (model) => {
      const changes = model.tree.changes;
      const moved = changes.find((c) => c.id === inner)!;
      const host = changes.find((c) => c.id === outer)!;
      return {
        tree: { ...model.tree, changes: [{ ...host, children: [...(host.children ?? []), moved] }] },
        result: undefined,
      };
    });

    const [listed] = await listAttachments(rexDir, [inner]);
    expect(listed.files.map((p) => basename(p))).toEqual(["diagram.png"]);
    expect(dirname(listed.files[0])).not.toBe(dirname(image));
    const folders = new Map<string, string>();
    await loadPrdModel(rexDir, { ...quiet, folders });
    expect(dirname(listed.files[0])).toBe(folders.get(inner));
    expect(dirname(folders.get(inner)!)).toBe(folders.get(outer));
  });
});

describe("attachment helpers", () => {
  it("names a file from its stem, falling back to image", () => {
    expect(attachmentFileName("Screen Shot 2026-11-17 at 10.00.00.png", "image/png", new Set())).toBe("screen-shot-2026-11-17-at-10-00-00.png");
    expect(attachmentFileName("", "image/webp", new Set())).toBe("image.webp");
    expect(attachmentFileName("../../etc/passwd", "image/gif", new Set())).toBe("passwd.gif");
    expect(attachmentFileName("C:\\Users\\me\\shot.png", "image/png", new Set())).toBe("shot.png");
    expect(attachmentFileName("index", "image/png", new Set(["index.png"]))).toBe("index-2.png");
  });

  it("checks each type's signature", () => {
    expect(matchesImageSignature("image/png", PNG)).toBe(true);
    expect(matchesImageSignature("image/jpeg", JPEG)).toBe(true);
    expect(matchesImageSignature("image/gif", new TextEncoder().encode("GIF89a..."))).toBe(true);
    expect(matchesImageSignature("image/webp", new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe(true);
    expect(matchesImageSignature("image/png", JPEG)).toBe(false);
  });
});
