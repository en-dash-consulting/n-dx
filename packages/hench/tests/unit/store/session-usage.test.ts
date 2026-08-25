import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readUsageDelta,
  resolveTranscriptPath,
  loadUsageCursor,
  saveUsageCursor,
  EMPTY_CURSOR,
} from "../../../src/store/session-usage.js";

/**
 * Reading an assisted run's own token usage out of the Claude Code transcript.
 *
 * Claude Code does not hand a skill its token counts, but it does write them:
 * every assistant message in the session transcript carries a `usage` object.
 * `CLAUDE_CODE_SESSION_ID` is exported to tools and names the transcript file, so
 * the numbers are readable rather than unknowable.
 *
 * The delta is what matters. One Claude Code session routinely completes several
 * tasks — the session this was built in completed four — so attributing the
 * session TOTAL per record would count the same tokens once per task. Each record
 * therefore takes only what accumulated since the last one, tracked by a cursor.
 */

/** One transcript line, in the shape Claude Code writes. */
function assistantLine(
  uuid: string,
  usage: Partial<{
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  }>,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    type: "assistant",
    uuid,
    timestamp: new Date(0).toISOString(),
    message: { model: "claude-opus-5", usage, ...(extra.message as object | undefined) },
    ...extra,
  });
}

/** A line with no usage — user turns and tool results look like this. */
function userLine(uuid: string): string {
  return JSON.stringify({ type: "user", uuid, message: { content: "hi" } });
}

describe("readUsageDelta", () => {
  it("maps the four usage fields onto TokenUsage", () => {
    const transcript = [
      assistantLine("a", {
        input_tokens: 3,
        output_tokens: 100,
        cache_creation_input_tokens: 50,
        cache_read_input_tokens: 9000,
      }),
    ].join("\n");

    const delta = readUsageDelta(transcript, EMPTY_CURSOR);

    expect(delta.tokenUsage).toEqual({
      input: 3,
      output: 100,
      cacheCreationInput: 50,
      cacheReadInput: 9000,
    });
    expect(delta.messages).toBe(1);
    expect(delta.model).toBe("claude-opus-5");
  });

  it("sums across messages and treats missing fields as zero", () => {
    const transcript = [
      assistantLine("a", { input_tokens: 1, output_tokens: 10 }),
      assistantLine("b", { output_tokens: 5, cache_read_input_tokens: 7 }),
    ].join("\n");

    const delta = readUsageDelta(transcript, EMPTY_CURSOR);

    expect(delta.tokenUsage).toEqual({
      input: 1,
      output: 15,
      cacheCreationInput: 0,
      cacheReadInput: 7,
    });
  });

  it("ignores lines with no usage, and lines that do not parse", () => {
    const transcript = [
      userLine("u1"),
      "{ not json",
      "",
      assistantLine("a", { output_tokens: 4 }),
      JSON.stringify({ type: "assistant", uuid: "b", message: { model: "m" } }), // no usage
    ].join("\n");

    const delta = readUsageDelta(transcript, EMPTY_CURSOR);

    // A truncated final line is normal: the transcript is appended to while the
    // session runs, so a read can land mid-write.
    expect(delta.messages).toBe(1);
    expect(delta.tokenUsage.output).toBe(4);
  });

  it("counts only what arrived after the cursor", () => {
    const first = [
      assistantLine("a", { output_tokens: 10 }),
      assistantLine("b", { output_tokens: 20 }),
    ].join("\n");

    const firstDelta = readUsageDelta(first, EMPTY_CURSOR);
    expect(firstDelta.tokenUsage.output).toBe(30);

    // Session continues; the same transcript grows.
    const second = [first, assistantLine("c", { output_tokens: 5 })].join("\n");
    const secondDelta = readUsageDelta(second, firstDelta.cursor);

    // 5, not 35. This is the whole point: two records in one session must not
    // both claim the tokens the first one already accounted for.
    expect(secondDelta.tokenUsage.output).toBe(5);
    expect(secondDelta.messages).toBe(1);
  });

  it("advances the cursor to the last message it attributed", () => {
    const transcript = [
      assistantLine("a", { output_tokens: 1 }),
      assistantLine("b", { output_tokens: 1 }),
    ].join("\n");

    const delta = readUsageDelta(transcript, EMPTY_CURSOR);

    expect(delta.cursor).toEqual({ lastUuid: "b", consumed: 2 });
  });

  it("reports a zero delta, and holds the cursor, when nothing is new", () => {
    const transcript = assistantLine("a", { output_tokens: 9 });
    const first = readUsageDelta(transcript, EMPTY_CURSOR);

    const again = readUsageDelta(transcript, first.cursor);

    expect(again.messages).toBe(0);
    expect(again.tokenUsage).toEqual({ input: 0, output: 0, cacheCreationInput: 0, cacheReadInput: 0 });
    expect(again.cursor).toEqual(first.cursor);
    expect(again.resynced).toBe(false);
  });

  it("falls back to a count-based skip when the cursor's message is gone", () => {
    // Transcripts are rewritten on compaction, so a remembered uuid can vanish.
    // Re-summing from the top would double-count everything already recorded, so
    // the count is used instead and the caller is told the cursor was resynced.
    const rewritten = [
      assistantLine("x", { output_tokens: 100 }),
      assistantLine("y", { output_tokens: 200 }),
      assistantLine("z", { output_tokens: 7 }),
    ].join("\n");

    const delta = readUsageDelta(rewritten, { lastUuid: "vanished", consumed: 2 });

    expect(delta.resynced).toBe(true);
    expect(delta.tokenUsage.output).toBe(7);
    expect(delta.cursor).toEqual({ lastUuid: "z", consumed: 3 });
  });

  it("does not rewind the watermark when the newest scanned message has no uuid", () => {
    // uuid is typed optional and the transcript is untrusted JSON. Keeping the
    // OLD lastUuid while `consumed` advances past it makes the next read start
    // over from the stale uuid — lastUuid takes precedence over `consumed` — so
    // everything between the two is claimed twice. With no uuid at the tail the
    // uuid watermark must be dropped so the count governs.
    const uuidless = (output: number) =>
      JSON.stringify({
        type: "assistant",
        message: { model: "claude-opus-5", usage: { output_tokens: output } },
      });

    const r1 = readUsageDelta(assistantLine("u1", { output_tokens: 10 }), EMPTY_CURSOR);
    expect(r1.cursor).toEqual({ lastUuid: "u1", consumed: 1 });

    const grown = [assistantLine("u1", { output_tokens: 10 }), uuidless(20), uuidless(30)].join(
      "\n",
    );
    const r2 = readUsageDelta(grown, r1.cursor);
    expect(r2.tokenUsage.output).toBe(50);
    expect(r2.cursor.lastUuid).toBeUndefined();
    expect(r2.cursor.consumed).toBe(3);

    const r3 = readUsageDelta(
      [grown, assistantLine("u2", { output_tokens: 7 })].join("\n"),
      r2.cursor,
    );
    // 7, not 57: the 50 uuid-less tokens r2 already claimed must not resurface.
    expect(r3.tokenUsage.output).toBe(7);
    expect(r3.cursor).toEqual({ lastUuid: "u2", consumed: 4 });
  });

  describe("window start", () => {
    /** A message stamped at a known time. */
    function at(uuid: string, iso: string, output: number): string {
      return JSON.stringify({
        type: "assistant",
        uuid,
        timestamp: iso,
        message: { model: "claude-opus-5", usage: { output_tokens: output } },
      });
    }

    it("ignores spend from before the work started", () => {
      // The gap the cursor cannot close: a first record in an established
      // session would otherwise claim everything spent before it began.
      const transcript = [
        at("old", "2026-08-20T10:00:00.000Z", 1000),
        at("new", "2026-08-20T12:00:00.000Z", 7),
      ].join("\n");

      const delta = readUsageDelta(transcript, EMPTY_CURSOR, "2026-08-20T11:00:00.000Z");

      expect(delta.tokenUsage.output).toBe(7);
      expect(delta.messages).toBe(1);
    });

    it("marks excluded messages consumed so the next record cannot claim them", () => {
      const transcript = [
        at("old", "2026-08-20T10:00:00.000Z", 1000),
        at("new", "2026-08-20T12:00:00.000Z", 7),
      ].join("\n");

      const first = readUsageDelta(transcript, EMPTY_CURSOR, "2026-08-20T11:00:00.000Z");
      const second = readUsageDelta(transcript, first.cursor);

      expect(first.cursor.consumed).toBe(2);
      expect(second.messages).toBe(0);
      expect(second.tokenUsage.output).toBe(0);
    });

    it("keeps messages whose timestamp is missing or unparseable", () => {
      // Dropping real spend on the strength of a missing field would be the
      // worse error of the two.
      const transcript = [
        // No timestamp field at all, and one that cannot be parsed.
        JSON.stringify({
          type: "assistant",
          uuid: "no-stamp",
          message: { usage: { output_tokens: 5 } },
        }),
        JSON.stringify({
          type: "assistant",
          uuid: "bad-stamp",
          timestamp: "not-a-date",
          message: { usage: { output_tokens: 3 } },
        }),
      ].join("\n");

      expect(readUsageDelta(transcript, EMPTY_CURSOR, "2026-08-20T11:00:00.000Z").tokenUsage.output).toBe(8);
    });

    it("ignores an unparseable window start rather than dropping everything", () => {
      const transcript = at("a", "2026-08-20T12:00:00.000Z", 9);

      expect(readUsageDelta(transcript, EMPTY_CURSOR, "whenever").tokenUsage.output).toBe(9);
    });
  });

  it("counts subagent turns, which are spend like any other", () => {
    const transcript = [
      assistantLine("a", { output_tokens: 10 }),
      assistantLine("b", { output_tokens: 40 }, { isSidechain: true }),
    ].join("\n");

    expect(readUsageDelta(transcript, EMPTY_CURSOR).tokenUsage.output).toBe(50);
  });

  it("reports the most recent model when the session switched models", () => {
    const transcript = [
      assistantLine("a", { output_tokens: 1 }, { message: { model: "claude-sonnet-5", usage: {} } }),
      assistantLine("b", { output_tokens: 1 }),
    ].join("\n");

    // The record carries one model field; the latest is the least misleading
    // choice, and the per-message detail stays in the transcript.
    expect(readUsageDelta(transcript, EMPTY_CURSOR).model).toBe("claude-opus-5");
  });
});

describe("resolveTranscriptPath", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "session-usage-home-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("finds the transcript without having to derive the project slug", async () => {
    // The slug is a lossy transform of the project path (separators, colons and
    // underscores all collapse to dashes), so reproducing it is guesswork.
    // Session ids are unique, so the file is found by searching for it instead.
    const projectDir = join(home, ".claude", "projects", "C--Users-someone-Code-Projects-n-dx");
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, "session-abc.jsonl"), "", "utf-8");

    const found = await resolveTranscriptPath("session-abc", { home });

    expect(found).toBe(join(projectDir, "session-abc.jsonl"));
  });

  it("returns null when there is no transcript for the session", async () => {
    await mkdir(join(home, ".claude", "projects", "some-project"), { recursive: true });

    expect(await resolveTranscriptPath("session-missing", { home })).toBe(null);
  });

  it("returns null rather than throwing when no projects directory exists", async () => {
    expect(await resolveTranscriptPath("session-abc", { home })).toBe(null);
  });

  it("honours an explicit config directory", async () => {
    // CLAUDE_CONFIG_DIR relocates the whole tree.
    const configDir = join(home, "elsewhere");
    const projectDir = join(configDir, "projects", "proj");
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, "s1.jsonl"), "", "utf-8");

    expect(await resolveTranscriptPath("s1", { home, configDir })).toBe(join(projectDir, "s1.jsonl"));
  });

  it("honours CLAUDE_CONFIG_DIR when no explicit config directory is given", async () => {
    // record.ts calls resolveTranscriptPath with no opts, so a user who has
    // relocated their config tree gets found only if the env var is consulted
    // here. Missing it degrades to "no transcript" and a silent zero-token
    // record — the failure this feature exists to remove.
    const configDir = join(home, "relocated");
    const projectDir = join(configDir, "projects", "proj");
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, "s2.jsonl"), "", "utf-8");

    const previous = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    try {
      expect(await resolveTranscriptPath("s2", { home })).toBe(join(projectDir, "s2.jsonl"));

      // An explicit configDir still wins over the environment.
      const explicit = join(home, "explicit");
      const explicitProject = join(explicit, "projects", "proj");
      await mkdir(explicitProject, { recursive: true });
      await writeFile(join(explicitProject, "s3.jsonl"), "", "utf-8");
      expect(await resolveTranscriptPath("s3", { home, configDir: explicit })).toBe(
        join(explicitProject, "s3.jsonl"),
      );
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previous;
    }
  });
});

describe("usage cursor persistence", () => {
  let henchDir: string;

  beforeEach(async () => {
    henchDir = await mkdtemp(join(tmpdir(), "session-usage-hench-"));
  });

  afterEach(async () => {
    await rm(henchDir, { recursive: true, force: true });
  });

  it("starts empty for a session it has never seen", async () => {
    expect(await loadUsageCursor(henchDir, "brand-new")).toEqual(EMPTY_CURSOR);
  });

  it("round-trips a cursor", async () => {
    await saveUsageCursor(henchDir, "s1", { lastUuid: "abc", consumed: 12 });

    expect(await loadUsageCursor(henchDir, "s1")).toEqual({ lastUuid: "abc", consumed: 12 });
  });

  it("keeps cursors separate per session", async () => {
    await saveUsageCursor(henchDir, "s1", { lastUuid: "a", consumed: 1 });
    await saveUsageCursor(henchDir, "s2", { lastUuid: "b", consumed: 2 });

    expect(await loadUsageCursor(henchDir, "s1")).toEqual({ lastUuid: "a", consumed: 1 });
    expect(await loadUsageCursor(henchDir, "s2")).toEqual({ lastUuid: "b", consumed: 2 });
  });

  it("treats an unreadable cursor as empty rather than failing the record", async () => {
    // Losing a cursor costs accuracy on one record. Throwing would cost the
    // record itself, which is the thing being audited.
    await mkdir(join(henchDir, "usage-cursors"), { recursive: true });
    await writeFile(join(henchDir, "usage-cursors", "s1.json"), "{ truncated", "utf-8");

    expect(await loadUsageCursor(henchDir, "s1")).toEqual(EMPTY_CURSOR);
  });

  it("rejects a session id that would escape the cursor directory", async () => {
    // The id arrives from the environment, and it lands in a filename.
    await expect(saveUsageCursor(henchDir, "../escape", { consumed: 1 })).rejects.toThrow(
      /session id/i,
    );
    await expect(loadUsageCursor(henchDir, "../escape")).rejects.toThrow(/session id/i);
  });
});
