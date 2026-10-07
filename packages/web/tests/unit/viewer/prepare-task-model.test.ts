/**
 * The Prepare task modal's derived state: changed fields, the options an
 * execute sends, standing refusals, the admission line, and the command line —
 * which must be the argv the server spawns (`workCommandArgs`, the shared
 * builder; routes-hench-execute-options.test.ts pins the server's side).
 */

import { describe, it, expect } from "vitest";
import {
  admissionLine,
  changeCount,
  commandLine,
  commandWords,
  CONTEXT_FILE_PLACEHOLDER,
  defaultsOf,
  fallbackOf,
  isChanged,
  isSavedOnTask,
  saveBodyOf,
  saveCount,
  savedCount,
  optionsProblem,
  runOptionsOf,
  setField,
  standingRefusals,
  workspaceWarnings,
} from "../../../src/viewer/components/prepare-task-model.js";
import { workCommandArgs } from "../../../src/shared/index.js";
import { prepFixture } from "../../helpers/prep-fixture.js";

/** A minimal POSIX tokenizer: whitespace splits, single quotes are literal, an unquoted `<`/`>`/`|`/`&`/`;` throws. */
function posixWords(line: string): string[] {
  const words: string[] = [];
  let cur: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end < 0) throw new Error("unterminated quote");
      cur = (cur ?? "") + line.slice(i + 1, end);
      i = end;
    } else if (/\s/.test(c)) {
      if (cur !== null) words.push(cur);
      cur = null;
    } else if (/[<>|&;()]/.test(c)) {
      throw new Error(`unquoted shell operator ${c}`);
    } else {
      cur = (cur ?? "") + c;
    }
  }
  if (cur !== null) words.push(cur);
  return words;
}

describe("prepare task model", () => {
  const prep = prepFixture();
  const defaults = defaultsOf(prep);

  it("takes every default from the resolve JSON", () => {
    expect(defaults).toMatchObject({ model: "claude-sonnet", provider: "api", permissionMode: "acceptEdits", maxTurns: 50, contextNotes: "" });
  });

  it("counts a field as changed only while it differs from its default", () => {
    let edits = setField(defaults, {}, "maxTurns", 12);
    expect(isChanged(edits, "maxTurns")).toBe(true);
    edits = setField(defaults, edits, "maxTurns", 50);
    expect(isChanged(edits, "maxTurns")).toBe(false);
    expect(setField(defaults, {}, "contextNotes", "")).toEqual({});
  });

  it("sends only the changed fields", () => {
    const edits = setField(defaults, setField(defaults, {}, "model", "claude-opus"), "fresh", true);
    expect(runOptionsOf(defaults, edits)).toEqual({ model: "claude-opus", fresh: true });
    expect(runOptionsOf(defaults, {})).toEqual({});
    expect(changeCount(defaults, edits)).toBe(2);
  });

  it("drops a review model while review is off, and max turns on a CLI run", () => {
    const withModel = setField(defaults, {}, "reviewModel", "claude-opus");
    expect(runOptionsOf(defaults, withModel)).toEqual({});
    const reviewing = setField(defaults, withModel, "review", true);
    expect(runOptionsOf(defaults, reviewing)).toEqual({ review: true, reviewModel: "claude-opus" });

    const cli = setField(defaults, setField(defaults, {}, "maxTurns", 9), "provider", "cli");
    expect(runOptionsOf(defaults, cli)).toEqual({ provider: "cli" });
  });

  it("reports a value the shared table refuses", () => {
    expect(optionsProblem(defaults, setField(defaults, {}, "maxTurns", Number.NaN))?.key).toBe("maxTurns");
    expect(optionsProblem(defaults, setField(defaults, {}, "maxTurns", 9))).toBeNull();
  });

  it("clears the dirty-tree refusal when allow dirty tree is ticked, and no other", () => {
    const refused = prepFixture({
      refusals: [
        { code: "dirty-tree", message: "Uncommitted changes" },
        { code: "vendor-cli-missing", message: "No claude CLI" },
      ],
    });
    const d = defaultsOf(refused);
    expect(standingRefusals(refused, d, {}).map((r) => r.code)).toEqual(["dirty-tree", "vendor-cli-missing"]);
    expect(standingRefusals(refused, d, setField(d, {}, "allowDirty", true)).map((r) => r.code)).toEqual(["vendor-cli-missing"]);
  });

  it("warns that commits land on the anchor's branch and that a live run shares the tree", () => {
    expect(workspaceWarnings(prepFixture())).toEqual([]);
    const warned = workspaceWarnings(prepFixture({
      workspace: { key: null, root: "/repo", branch: "main", isAnchor: true, dirty: false, liveRun: true },
    }));
    expect(warned[0]).toBe("Commits land on main");
    expect(warned[1]).toMatch(/two runs would share one working tree/);
  });

  it("shows hench's warnings in the preflight", () => {
    const warned = workspaceWarnings(prepFixture({
      warnings: [{ code: "untrusted-repository", message: "Repository is not trusted" }],
    }));
    expect(warned).toEqual(["Repository is not trusted"]);
  });

  it("says the run will queue when the hub is full or memory-paused, and nothing alarming for an unknown reading", () => {
    expect(admissionLine(null)).toBeNull();
    const base = { running: 1, max: 2, queued: 0, availableBytes: null, pressure: "unknown" as const, memoryPaused: false };
    const open = admissionLine(base)!;
    expect(open.queues).toBe(false);
    expect(open.text).not.toMatch(/pressure|memory/i);
    expect(admissionLine({ ...base, running: 2 })!.text).toMatch(/^Execute will queue: every run slot is busy/);
    const paused = admissionLine({ ...base, memoryPaused: true, availableBytes: 2 * 1024 ** 3, pressure: "critical" })!;
    expect(paused.queues).toBe(true);
    expect(paused.text).toContain("available memory is below the floor");
    expect(paused.text).toContain("2.0 GB available, pressure critical");
  });

  it("builds the command with the server's builder, from the changed options", () => {
    const edits = setField(defaults, setField(defaults, {}, "contextNotes", "hi"), "review", true);
    const options = runOptionsOf(defaults, edits);
    expect(commandWords(prep, "task-1", defaults, edits)).toEqual([
      "ndx",
      ...workCommandArgs({ taskId: "task-1", options, dir: "/repo", contextFile: CONTEXT_FILE_PLACEHOLDER }),
    ]);
    expect(commandLine(prep, "task-1", defaults, edits))
      .toBe("ndx work --task=task-1 --auto --review '--context-file=<notes-file>' /repo");
    expect(posixWords(commandLine(prep, "task-1", defaults, edits)))
      .toContain(`--context-file=${CONTEXT_FILE_PLACEHOLDER}`);
  });

  it("updates the command as fields change, quoting what a shell would split", () => {
    const spaced = prepFixture({ dir: "/my repo" });
    const d = defaultsOf(spaced);
    expect(commandLine(spaced, "task-1", d, {})).toBe("ndx work --task=task-1 --auto '/my repo'");
    expect(commandLine(spaced, "task-1", d, setField(d, {}, "tokenBudget", 1000)))
      .toBe("ndx work --task=task-1 --auto --token-budget=1000 '/my repo'");
  });

  it("adds --reset-deferred for a deferred task, as the server does", () => {
    const deferred = prepFixture({ task: { id: "task-1", title: "t", status: "deferred", level: "task" } });
    expect(commandWords(deferred, "task-1", defaultsOf(deferred), {})).toContain("--reset-deferred");
  });
});

/**
 * A fixture whose task carries saved settings: the resolved entries name
 * `task.run` as their source and carry the project default as `fallback`, which
 * is what hench's `--resolve` reports for a saved field.
 */
function savedFixture(): ReturnType<typeof prepFixture> {
  const prep = prepFixture({
    saved: { models: { claude: "claude-opus" }, review: true },
    savedVersion: "abc123def456",
  });
  prep.resolved.model = {
    value: "claude-opus",
    source: "task.run.models",
    fallback: { value: "claude-sonnet", source: "llm.claude.model" },
  };
  prep.resolved.review = {
    value: true,
    source: "task.run",
    fallback: { value: false, source: "built-in" },
  };
  return prep;
}

describe("settings saved on the task", () => {
  it("tells a saved field from a project one, and names what it would fall back to", () => {
    const prep = savedFixture();

    expect(isSavedOnTask(prep, "model")).toBe(true);
    expect(isSavedOnTask(prep, "review")).toBe(true);
    expect(isSavedOnTask(prep, "provider")).toBe(false);

    expect(fallbackOf(prep, "model")).toEqual({ value: "claude-sonnet", source: "llm.claude.model" });
    // A field the project supplied has nothing to fall back *from*.
    expect(fallbackOf(prep, "provider")).toBeNull();
    expect(savedCount(prep)).toBe(2);
  });

  it("counts nothing saved for a task that carries no block", () => {
    const plain = prepFixture();
    expect(savedCount(plain)).toBe(0);
    expect(isSavedOnTask(plain, "model")).toBe(false);
  });

  describe("the block a Save writes", () => {
    it("carries saved fields forward untouched, in the vendor-agnostic shape", () => {
      // An exact model is keyed by the vendor this project is on: a saved block
      // may later be run under another vendor, where a bare id means nothing.
      const prep = savedFixture();
      const body = saveBodyOf(prep, defaultsOf(prep), {});

      expect(body).toEqual({ models: { claude: "claude-opus" }, review: true });
      expect(saveCount(prep, defaultsOf(prep), {})).toBe(2);
    });

    it("keeps a pin for a vendor this project is not on", () => {
      // The modal only ever resolves one vendor's model, so a block rebuilt
      // from the resolved value alone dropped a codex pin the moment a claude
      // session saved anything at all — silent loss in the one field whose
      // purpose is to survive a change of vendor.
      const prep = prepFixture({
        saved: { models: { claude: "claude-opus", codex: "gpt-5.6-sol" }, review: true },
      });
      prep.resolved.model = {
        value: "claude-opus",
        source: "task.run.models",
        fallback: { value: "claude-sonnet", source: "llm.claude.model" },
      };
      prep.resolved.review = { value: true, source: "task.run", fallback: { value: false, source: "built-in" } };
      const d = defaultsOf(prep);

      // Saving an unrelated setting must not disturb it.
      const body = saveBodyOf(prep, d, setField(d, {}, "maxTurns", 9));
      expect(body).toMatchObject({ models: { claude: "claude-opus", codex: "gpt-5.6-sol" }, maxTurns: 9 });

      // Editing this vendor's model overrides only this vendor's entry.
      const edited = saveBodyOf(prep, d, setField(d, {}, "model", "claude-haiku"));
      expect(edited).toMatchObject({ models: { claude: "claude-haiku", codex: "gpt-5.6-sol" } });
    });

    it("keeps another vendor's pin even when this vendor is back at the project default", () => {
      const prep = prepFixture({ saved: { models: { codex: "gpt-5.6-sol" } } });
      const d = defaultsOf(prep);

      // This project is on claude and its model is the project default, so the
      // model field contributes nothing — the codex pin must survive anyway.
      expect(saveBodyOf(prep, d, {})).toEqual({ models: { codex: "gpt-5.6-sol" } });
    });

    it("writes an edit over the saved value", () => {
      const prep = savedFixture();
      const d = defaultsOf(prep);
      const body = saveBodyOf(prep, d, setField(d, {}, "maxTurns", 9));

      expect(body).toMatchObject({ models: { claude: "claude-opus" }, review: true, maxTurns: 9 });
    });

    it("omits a field equal to the project default rather than freezing it", () => {
      // Saving "the default as it is today" would pin the task against a config
      // change the reader never meant to opt out of.
      const prep = prepFixture();
      const d = defaultsOf(prep);

      expect(saveBodyOf(prep, d, {})).toBeNull();
      expect(saveBodyOf(prep, d, setField(d, {}, "provider", d.provider))).toBeNull();
    });

    it("never carries a launch-time field", () => {
      const prep = prepFixture();
      const d = defaultsOf(prep);
      const edits = setField(d, setField(d, {}, "fresh", true), "allowDirty", true);

      // Those two are real edits for the run …
      expect(runOptionsOf(d, edits)).toMatchObject({ fresh: true, allowDirty: true });
      // … and still never saved.
      expect(saveBodyOf(prep, d, edits)).toBeNull();
    });

    it("drops a reviewer pin when no review would run", () => {
      const prep = prepFixture();
      const d = defaultsOf(prep);
      const edits = setField(d, {}, "reviewModel", "claude-opus");

      expect(saveBodyOf(prep, d, edits)).toBeNull();
    });

    it("keeps the reviewer pin when review is on", () => {
      const prep = prepFixture();
      const d = defaultsOf(prep);
      let edits = setField(d, {}, "review", true);
      edits = setField(d, edits, "reviewModel", "claude-opus");

      expect(saveBodyOf(prep, d, edits)).toEqual({
        review: true,
        reviewModels: { claude: "claude-opus" },
      });
    });

    it("writes notes as an ordinary saved setting", () => {
      const prep = prepFixture();
      const d = defaultsOf(prep);

      expect(saveBodyOf(prep, d, setField(d, {}, "contextNotes", "mind the lock")))
        .toEqual({ contextNotes: "mind the lock" });
    });
  });

  describe("switching off a setting the task or the config turned on", () => {
    it("sends false so the run gets the negation flag", () => {
      // `--no-review`: without this the edit would vanish and the run would
      // review anyway, which is the opposite of what the reader asked for.
      const prep = savedFixture();
      const d = defaultsOf(prep);
      const edits = setField(d, {}, "review", false);

      expect(runOptionsOf(d, edits)).toMatchObject({ review: false });
      expect(commandLine(prep, "task-1", d, edits)).toContain("--no-review");
    });

    it("says nothing when the setting was off anyway", () => {
      // A `false` that matches the default is not an instruction, and
      // `--no-review` on a run that was never going to review is noise.
      const prep = prepFixture();
      const d = defaultsOf(prep);

      expect(runOptionsOf(d, { review: false })).toEqual({});
      expect(commandLine(prep, "task-1", d, { review: false })).not.toContain("--no-review");
    });

    it("leaves a non-negatable boolean alone", () => {
      // `fresh` and `allowDirty` have no negation: their absence already reads
      // as off, so a false must not start emitting anything.
      const prep = prepFixture();
      const d = defaultsOf(prep);

      expect(runOptionsOf(d, { fresh: false, allowDirty: false })).toEqual({});
    });
  });
});
