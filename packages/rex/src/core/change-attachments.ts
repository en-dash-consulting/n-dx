/**
 * Images attached to a change-layer node on a v2 tree.
 *
 * An attachment is a plain image file stored beside the node's `index.md`, in
 * the node's own folder. The writer already treats every file there that is not
 * `.md` or `state.yaml` as the node's own: it is carried along when the change
 * moves (Inbox to placed, reparented) and never deleted as stale. So there is
 * no field to keep in step and nothing for a reader to parse; the folder is the
 * record. Only folder nodes can hold one, which every change is.
 *
 * Writes take the PRD lock, so an image cannot land in a folder another writer
 * is moving at the same moment.
 */

import { readdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { withLock } from "../store/file-lock.js";
import { prdLockPath } from "../store/paths.js";
import { loadPrdModel } from "../store/prd-model-reader.js";

/** Image types an attachment may be, with the extension each is stored under. */
export const ATTACHMENT_IMAGE_TYPES = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
} as const;

export type AttachmentImageType = keyof typeof ATTACHMENT_IMAGE_TYPES;

/** Largest image accepted, in bytes: the per-image ceiling the vision APIs take. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** Most images one call attaches. */
export const MAX_ATTACHMENTS_PER_CALL = 8;

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

/** One image to attach: a display name, its declared type, and its bytes. */
export interface AttachmentImage {
  name: string;
  mediaType: string;
  data: Uint8Array;
}

/** An input the caller should correct; the message says what is wrong with it. */
export class AttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentError";
  }
}

/** Whether `mediaType` is one {@link ATTACHMENT_IMAGE_TYPES} accepts. */
export function isAttachmentImageType(mediaType: string): mediaType is AttachmentImageType {
  return Object.prototype.hasOwnProperty.call(ATTACHMENT_IMAGE_TYPES, mediaType);
}

/** Whether `data` starts with the signature of `mediaType`, so a renamed file of another kind is refused. */
export function matchesImageSignature(mediaType: AttachmentImageType, data: Uint8Array): boolean {
  const starts = (...bytes: number[]) => bytes.every((b, i) => data[i] === b);
  const ascii = (offset: number, text: string) => [...text].every((c, i) => data[offset + i] === c.charCodeAt(0));
  switch (mediaType) {
    case "image/png":
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "image/gif":
      return ascii(0, "GIF87a") || ascii(0, "GIF89a");
    case "image/webp":
      return ascii(0, "RIFF") && ascii(8, "WEBP");
  }
}

/** Throw {@link AttachmentError} unless every image is an accepted type, signature and size. */
export function validateAttachmentImages(images: readonly AttachmentImage[]): void {
  if (images.length === 0) throw new AttachmentError("No images to attach.");
  if (images.length > MAX_ATTACHMENTS_PER_CALL) {
    throw new AttachmentError(`At most ${MAX_ATTACHMENTS_PER_CALL} images can be attached at once; got ${images.length}.`);
  }
  for (const image of images) {
    const label = image.name || "an image";
    if (!isAttachmentImageType(image.mediaType)) {
      throw new AttachmentError(`${label}: ${image.mediaType || "an unknown type"} is not supported. Attach a PNG, JPEG, GIF or WebP image.`);
    }
    if (image.data.byteLength === 0) throw new AttachmentError(`${label} is empty.`);
    if (image.data.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new AttachmentError(`${label} is ${(image.data.byteLength / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`);
    }
    if (!matchesImageSignature(image.mediaType, image.data)) {
      throw new AttachmentError(`${label} is not a ${image.mediaType} file.`);
    }
  }
}

/**
 * The file name an image is stored under: its name's stem (last path segment,
 * extension dropped) as a lowercase slug
 * (`image` when nothing usable is left), the type's extension, and a counter
 * when the folder already has an entry of that name, compared case-insensitively.
 */
export function attachmentFileName(name: string, mediaType: AttachmentImageType, taken: ReadonlySet<string>): string {
  // The last path segment only: a name is a label, never a place to write.
  const stem = (name.split(/[\\/]/).pop() ?? "").replace(/\.[^.]*$/, "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "") || "image";
  const ext = ATTACHMENT_IMAGE_TYPES[mediaType];
  for (let n = 1; ; n++) {
    const candidate = `${stem}${n === 1 ? "" : `-${n}`}${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** The folder each folder node of the v2 tree under `rexDir` is stored in, by id. */
async function foldersOf(rexDir: string): Promise<Map<string, string>> {
  const folders = new Map<string, string>();
  const model = await loadPrdModel(rexDir, { folders });
  if (model.layout !== "v2") throw new AttachmentError("Images can be attached only on a v2 PRD (product/ and changes/).");
  return folders;
}

/**
 * Store `images` in the folder of change-layer node `id`. Returns the paths
 * written, in input order. Refuses, writing nothing, when an image is invalid
 * or the node has no folder of its own.
 */
export async function attachImages(rexDir: string, id: string, images: readonly AttachmentImage[]): Promise<string[]> {
  validateAttachmentImages(images);
  return withLock(prdLockPath(rexDir), async () => {
    const dir = (await foldersOf(rexDir)).get(id);
    if (!dir) {
      throw new AttachmentError(`${id} has no folder of its own to hold images. Attach them to its change.`);
    }
    const taken = new Set((await readdir(dir)).map((name) => name.toLowerCase()));
    const written: string[] = [];
    for (const image of images) {
      const name = attachmentFileName(image.name, image.mediaType as AttachmentImageType, taken);
      taken.add(name.toLowerCase());
      const path = join(dir, name);
      // `wx`: never overwrite, even if a file of that name appeared since the listing.
      await writeFile(path, image.data, { flag: "wx" });
      written.push(path);
    }
    return written;
  });
}

/** The image files attached to one node. */
export interface NodeAttachments {
  id: string;
  /** Absolute paths, sorted by name. */
  files: string[];
}

/**
 * The images attached to each node in `ids` that has any, in `ids` order. A
 * v1 tree, a leaf node and a folder with no images contribute nothing.
 */
export async function listAttachments(rexDir: string, ids: readonly string[]): Promise<NodeAttachments[]> {
  const folders = new Map<string, string>();
  const model = await loadPrdModel(rexDir, { folders });
  if (model.layout !== "v2") return [];
  const out: NodeAttachments[] = [];
  for (const id of new Set(ids)) {
    const dir = folders.get(id);
    if (!dir) continue;
    const files = (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isFile() && !e.name.startsWith(".") && IMAGE_EXTENSIONS.has(extname(e.name).toLowerCase()))
      .map((e) => e.name)
      .sort()
      .map((name) => join(dir, name));
    if (files.length) out.push({ id, files });
  }
  return out;
}
