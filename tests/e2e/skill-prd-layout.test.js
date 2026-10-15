/**
 * Structural tests: the PRD skills branch on the layout they find.
 *
 * A v2 tree (`.rex/product/` and `.rex/changes/`) has no levels: `add_item`
 * refuses `level` and takes `type` (`change`, `task`, `subtask`), an untargeted
 * change lands in the Inbox with `needsPlacement`, and `edit_item` refuses a
 * level change. A v1 tree (`.rex/prd_tree/` only) still takes `level`. A skill
 * that knows one layout fails every write on the other, so each skill states
 * how to tell them apart and gives each branch its own line, marked
 * `**v1 tree:**` or `**v2 tree:**`. These tests read those lines.
 *
 * @see packages/rex/src/cli/mcp-tools/add-item.ts — addV2, the v2 refusal of level
 * @see packages/rex/src/cli/mcp-tools/edit-item.ts — the v2 refusal of a level change
 * @see packages/rex/src/cli/mcp-tools/place-change.ts — the Inbox shortlist
 */

import { describe, it, expect } from "vitest";
import { getManifest, getSkillBody, renderSkill } from "../../packages/core/assistant-assets.js";

const PRD_SKILLS = ["ndx-capture", "ndx-plan", "ndx-reshape", "ndx-work", "ndx-adversarial-review"];
const ITEM_CREATING = ["ndx-capture", "ndx-plan", "ndx-reshape", "ndx-adversarial-review"];
const LAYOUT_CHECK = "**Find the PRD layout";
const V2_PATHS = ["`.rex/changes/`", "`.rex/product/`"];

/** Lines that carry a branch marker for `layout` (`v1` or `v2`). */
function branchLines(body, layout) {
  return body.split("\n").filter((line) => line.includes(`**${layout} tree:**`));
}

/** The line that holds offset `at`: one list item, since the skills write each step on one line. */
function lineAt(text, at) {
  const end = text.indexOf("\n", at);
  return text.slice(text.lastIndexOf("\n", at) + 1, end === -1 ? text.length : end);
}

/** The blank-line-bounded paragraph that holds offset `at`. */
function paragraphAt(text, at) {
  const start = text.lastIndexOf("\n\n", at);
  const end = text.indexOf("\n\n", at);
  return text.slice(start === -1 ? 0 : start, end === -1 ? text.length : end);
}

describe("PRD skills find the layout before they write", () => {
  for (const name of PRD_SKILLS) {
    const body = getSkillBody(name);

    it(`${name}: states how to tell a v2 tree from a v1 tree`, () => {
      const at = body.indexOf(LAYOUT_CHECK);
      expect(at, `${name} has no "${LAYOUT_CHECK}" step`).toBeGreaterThan(-1);
      const para = paragraphAt(body, at);
      expect(para).toContain('"layout": "v2"');
      for (const p of [...V2_PATHS, "`.rex/prd_tree/`"]) expect(para).toContain(p);
    });

    it(`${name}: has a line for each layout`, () => {
      expect(branchLines(body, "v1").length, `${name} has no **v1 tree:** line`).toBeGreaterThan(0);
      expect(branchLines(body, "v2").length, `${name} has no **v2 tree:** line`).toBeGreaterThan(0);
    });

    it(`${name}: never creates an epic or a feature on a v2 tree`, () => {
      for (const line of branchLines(body, "v2")) {
        expect(line, `a v2 line asks for an epic or feature: ${line}`).not.toMatch(/`(epic|feature)`/);
      }
    });

    it(`${name}: Codex and Claude receive the same body`, () => {
      const strip = (s) => s.slice(s.indexOf("\n---", 3) + 5);
      expect(strip(renderSkill(name, "codex"))).toBe(strip(renderSkill(name, "claude")));
      expect(strip(renderSkill(name, "claude")).trim()).toBe(body.trim());
    });
  }
});

describe("item-creating skills pass type on v2 and level on v1", () => {
  for (const name of ITEM_CREATING) {
    const body = getSkillBody(name);

    it(`${name}: a v2 line passes \`type\` to add_item`, () => {
      const lines = branchLines(body, "v2").filter((l) => l.includes("`type`"));
      expect(lines.length, `${name} has no v2 line naming \`type\``).toBeGreaterThan(0);
      expect(lines.join("\n")).toMatch(/`change`/);
    });

    it(`${name}: no v2 line asks for \`level\` except to forbid it`, () => {
      for (const line of branchLines(body, "v2").filter((l) => l.includes("`level`"))) {
        expect(line, `v2 line names level without forbidding it: ${line}`).toMatch(/never|refuses/);
      }
    });

    it(`${name}: a v1 line still passes \`level\``, () => {
      expect(branchLines(body, "v1").some((l) => l.includes("`level`"))).toBe(true);
    });
  }
});

describe("/ndx-capture places an unplaced change", () => {
  const body = getSkillBody("ndx-capture");

  it("says an unplaced v2 capture goes to the Inbox and shows place_change's suggestion before it ends", () => {
    const lines = branchLines(body, "v2").join("\n");
    expect(lines).toMatch(/Inbox/);
    expect(lines).toMatch(/needsPlacement/);
    expect(lines).toMatch(/`place_change`[^\n]*no `target`/);
    expect(lines).toMatch(/before the run ends/);
  });
});

describe("/ndx-reshape restructures changes with the v2 tools", () => {
  const body = getSkillBody("ndx-reshape");
  const lines = branchLines(body, "v2").join("\n");

  it("uses place_change, move_item and merge_items on changes", () => {
    for (const tool of ["place_change", "move_item", "merge_items"]) expect(lines).toContain(`\`${tool}\``);
  });

  it("never asks edit_item for a level change on v2", () => {
    for (const line of branchLines(body, "v2").filter((l) => l.includes("`edit_item`"))) {
      if (line.includes("`level`")) expect(line).toMatch(/never|refuses/);
    }
    expect(lines).toMatch(/type is fixed/);
  });
});

describe("v2 PRD paths are covered by the overlap checks and commits", () => {
  it("/ndx-work's overlap check names .rex/changes/, .rex/product/ and state.yaml beside .rex/prd_tree/", () => {
    const body = getSkillBody("ndx-work");
    const para = lineAt(body, body.indexOf("ask the user to commit or stash"));
    for (const p of ["`.rex/prd_tree/`", ...V2_PATHS, "`state.yaml`"]) expect(para).toContain(p);
  });

  it("/ndx-adversarial-review's commit pathspec includes .rex/changes/ and .rex/product/", () => {
    const body = getSkillBody("ndx-adversarial-review");
    expect(body).toContain(
      "git -c core.quotepath=false status --porcelain --untracked-files=all -- .rex/prd_tree/ .rex/changes/ .rex/product/",
    );
  });

  for (const name of ["ndx-capture", "ndx-plan", "ndx-reshape", "ndx-adversarial-review"]) {
    it(`${name}: overlap check names the v2 folders`, () => {
      const body = getSkillBody(name);
      const para = lineAt(body, body.indexOf("ask the user to commit or stash"));
      for (const p of V2_PATHS) expect(para).toContain(p);
    });
  }
});

describe("manifest descriptions stay layout-neutral", () => {
  // The description becomes the skill's frontmatter and is how an assistant picks
  // it, so it must not promise an epic or a level change a v2 tree refuses.
  for (const name of PRD_SKILLS) {
    it(`${name}: description names no epic or level change`, () => {
      const { description } = getManifest().skills[name];
      expect(description).not.toMatch(/\bepics?\b/i);
      expect(description).not.toMatch(/\blevels?\b/i);
    });
  }
});
