/**
 * Image attachments for Quick Add on a v2 PRD.
 *
 * The capture box shows a "+" beside its input when the model `ndx work` runs
 * takes images (`imageInput` on GET /api/llm/config). Picked or pasted images
 * show as thumbnails below the input until Add, which creates the change and
 * then sends each image to POST /api/rex/items/:id/attachments. Rex stores
 * them in the change's folder, and the agent's brief names them.
 *
 * The limits here mirror rex's (`core/change-attachments.ts`), so a file the
 * server would refuse is refused on pick, before anything is created.
 */

import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { errorOrHttpStatus } from "../../utils/response-error.js";

/** Image types rex accepts as an attachment. */
export const ATTACHABLE_IMAGE_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** Largest image rex accepts, in bytes. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Most images one capture carries. */
export const MAX_IMAGES = 8;

/** An image waiting to be attached when the change is added. */
export interface PendingImage {
  /** Stable key for the list. */
  key: string;
  name: string;
  mediaType: string;
  size: number;
  /** The image's bytes in base64, as the attach route takes them. */
  data: string;
  /** A `data:` URL for the thumbnail. */
  url: string;
}

/** What a pick keeps, and why it dropped the rest. */
export interface ImagePick {
  accepted: File[];
  problems: string[];
}

/**
 * Split picked `files` into the ones that can be attached and a message for
 * each that cannot: a type rex refuses, one over the size limit, or one past
 * the count limit given `already` images waiting.
 */
export function checkImageFiles(files: ReadonlyArray<Pick<File, "name" | "type" | "size">>, already: number): ImagePick {
  const accepted: File[] = [];
  const problems: string[] = [];
  for (const file of files) {
    const label = file.name || "Pasted image";
    if (!ATTACHABLE_IMAGE_TYPES.includes(file.type)) {
      problems.push(`${label}: only PNG, JPEG, GIF and WebP images can be attached.`);
    } else if (file.size > MAX_IMAGE_BYTES) {
      problems.push(`${label} is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
    } else if (already + accepted.length >= MAX_IMAGES) {
      problems.push(`${label}: at most ${MAX_IMAGES} images can be attached.`);
    } else {
      accepted.push(file as File);
    }
  }
  return { accepted, problems };
}

let nextKey = 0;

/** Read `file` into a {@link PendingImage}. */
export function readPendingImage(file: File): Promise<PendingImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
    reader.onload = () => {
      const url = String(reader.result);
      const comma = url.indexOf(",");
      resolve({
        key: `img-${++nextKey}`,
        name: file.name || `pasted-image${extensionOf(file.type)}`,
        mediaType: file.type,
        size: file.size,
        data: comma >= 0 ? url.slice(comma + 1) : "",
        url,
      });
    };
    reader.readAsDataURL(file);
  });
}

function extensionOf(mediaType: string): string {
  return mediaType === "image/jpeg" ? ".jpg" : `.${mediaType.replace(/^image\//, "")}`;
}

/** The image files on a paste or drop, if any. */
export function imageFilesOf(items: DataTransferItemList | null | undefined): File[] {
  if (!items) return [];
  const out: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) out.push(file);
  }
  return out;
}

/**
 * Whether the model `ndx work` runs takes images, from GET /api/llm/config.
 * False until it answers, when `enabled` is false, and when the read fails, so
 * the "+" appears only once the server has said yes.
 */
export function useImageInputSupport(enabled: boolean): boolean {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setSupported(false);
      return;
    }
    let cancelled = false;
    fetch("/api/llm/config")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { imageInput?: unknown } | null) => {
        if (!cancelled) setSupported(body?.imageInput === true);
      })
      .catch(() => {
        if (!cancelled) setSupported(false);
      });
    return () => { cancelled = true; };
  }, [enabled]);
  return supported;
}

/**
 * Send `images` to each change in `ids`, one image per request so each stays
 * well under the server's body limit. Stops at the first refusal.
 */
export async function uploadAttachments(ids: readonly string[], images: readonly PendingImage[]): Promise<void> {
  for (const id of ids) {
    for (const image of images) {
      const res = await fetch(`/api/rex/items/${encodeURIComponent(id)}/attachments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: [{ name: image.name, mediaType: image.mediaType, data: image.data }] }),
      });
      if (!res.ok) throw new Error(await errorOrHttpStatus(res, `Could not attach ${image.name}`));
    }
  }
}

export interface AttachImageButtonProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  count: number;
}

/** The "+" beside the capture input, with the hidden file picker it opens. */
export function AttachImageButton({ onFiles, disabled, count }: AttachImageButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const full = count >= MAX_IMAGES;
  return h("span", { class: "smart-add-attach" },
    h("button", {
      type: "button",
      class: "cmd-btn cmd-btn-secondary smart-add-btn-attach",
      onClick: () => inputRef.current?.click(),
      disabled: disabled || full,
      title: full ? `At most ${MAX_IMAGES} images` : "Attach images (or paste one into the box)",
      "aria-label": "Attach images",
    }, "+"),
    h("input", {
      ref: inputRef,
      type: "file",
      accept: ATTACHABLE_IMAGE_TYPES.join(","),
      multiple: true,
      hidden: true,
      class: "smart-add-attach-input",
      onChange: (e: Event) => {
        const input = e.target as HTMLInputElement;
        const files = input.files ? Array.from(input.files) : [];
        // Cleared so picking the same file again still fires a change.
        input.value = "";
        if (files.length) onFiles(files);
      },
    }),
  );
}

export interface AttachmentPreviewProps {
  images: readonly PendingImage[];
  onRemove: (key: string) => void;
  disabled?: boolean;
}

/** Thumbnails of the images waiting to be attached, each with a remove control. */
export function AttachmentPreview({ images, onRemove, disabled }: AttachmentPreviewProps) {
  if (images.length === 0) return null;
  return h("div", { class: "smart-add-attachments", role: "list", "aria-label": "Images to attach" },
    images.map((image) =>
      h("figure", { key: image.key, class: "smart-add-attachment", role: "listitem" },
        h("img", { class: "smart-add-attachment-thumb", src: image.url, alt: image.name }),
        h("figcaption", { class: "smart-add-attachment-name", title: image.name }, image.name),
        h("button", {
          type: "button",
          class: "smart-add-attachment-remove",
          onClick: () => onRemove(image.key),
          disabled,
          "aria-label": `Remove ${image.name}`,
          title: "Remove",
        }, "×"),
      ),
    ),
  );
}
