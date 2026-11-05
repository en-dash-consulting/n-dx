/** Readable names for the Sidecar agent pickers. Values stay the vendor and model ids. */

const VENDOR_NAMES: Record<string, string> = { claude: "Claude", codex: "Codex" };

/** "claude" → "Claude"; an unknown vendor is shown as it is. */
export function vendorLabel(vendor: string): string {
  return VENDOR_NAMES[vendor] ?? vendor;
}

const CLAUDE_MODEL = /^claude-([a-z]+)-(\d+(?:-\d+)*)$/;

/**
 * A readable name for a model id: claude-opus-5-5 → "Opus 5.5",
 * claude-fable-5-1 → "Fable 5.1". Any other id (gpt-…, a dated or unknown
 * Claude id) is returned unchanged.
 */
export function modelLabel(id: string): string {
  const m = CLAUDE_MODEL.exec(id);
  if (!m) return id;
  // A trailing 8-digit part is a date stamp, not a version: leave that id alone.
  if (/(^|-)\d{8}$/.test(m[2]!)) return id;
  return `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} ${m[2]!.replace(/-/g, ".")}`;
}
