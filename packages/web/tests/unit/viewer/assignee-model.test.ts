/**
 * The assignee filter's default and matching, and the picker's choices and
 * free-form entry.
 *
 * @see src/viewer/components/assignee-model.ts
 */

import { describe, it, expect } from "vitest";
import {
  assigneeFilterOptions,
  assigneeFromInput,
  defaultAssigneeFilter,
  isMine,
  knownFilter,
  matchesAssigneeFilter,
  personLabel,
  pickerChoices,
} from "../../../src/viewer/components/assignee-model.js";
import type { KnownPerson } from "../../../src/viewer/external.js";

const ME = "Ann Lee <ann@shop.io>";
const ANN: KnownPerson = { id: ME, name: "Ann Lee", email: "ann@shop.io", sources: ["git"] };
const BO: KnownPerson = { id: "Bo Chen <bo@shop.io>", name: "Bo Chen", email: "bo@shop.io", sources: ["git", "steward"] };

describe("defaultAssigneeFilter", () => {
  it("is Mine when the current user has an open item assigned, in any spelling", () => {
    expect(defaultAssigneeFilter([{ assignee: "ANN@shop.io", open: true }, { open: true }], ME)).toBe("mine");
  });

  it("is All when the user's only items are closed", () => {
    expect(defaultAssigneeFilter([{ assignee: ME, open: false }, { assignee: BO.id, open: true }], ME)).toBe("all");
  });

  it("is All when nothing is assigned to the user, or the user is unknown", () => {
    expect(defaultAssigneeFilter([{ assignee: BO.id, open: true }], ME)).toBe("all");
    expect(defaultAssigneeFilter([{ assignee: ME, open: true }], null)).toBe("all");
  });
});

describe("matchesAssigneeFilter", () => {
  it("All matches every row, assigned or not", () => {
    for (const assignee of [undefined, ME, BO.id]) expect(matchesAssigneeFilter(assignee, "all", ME)).toBe(true);
  });

  it("Mine matches the current user by email", () => {
    expect(matchesAssigneeFilter("ann@shop.io", "mine", ME)).toBe(true);
    expect(matchesAssigneeFilter(BO.id, "mine", ME)).toBe(false);
    expect(matchesAssigneeFilter(undefined, "mine", ME)).toBe(false);
  });

  it("a person option matches that person by email", () => {
    expect(matchesAssigneeFilter("bo@shop.io", "person:bo@shop.io", ME)).toBe(true);
    expect(matchesAssigneeFilter(ME, "person:bo@shop.io", ME)).toBe(false);
  });

  it("isMine is false without both sides", () => {
    expect(isMine(undefined, ME)).toBe(false);
    expect(isMine(ME, null)).toBe(false);
  });
});

describe("assigneeFilterOptions", () => {
  it("offers Mine, All, then each assigned person once, by name", () => {
    const options = assigneeFilterOptions([
      { assignee: BO.id, open: true },
      { assignee: "bo@shop.io", open: false },
      { assignee: ME, open: true },
      { open: true },
    ], ME);
    expect(options).toEqual([
      { value: "mine", label: "Mine" },
      { value: "all", label: "All" },
      { value: "person:ann@shop.io", label: "Ann Lee" },
      { value: "person:bo@shop.io", label: "Bo Chen" },
    ]);
  });

  it("labels an assignee saved by email with the name the repository knows", () => {
    const options = assigneeFilterOptions([{ assignee: "bo@shop.io", open: true }], null, [ANN, BO]);
    expect(options).toContainEqual({ value: "person:bo@shop.io", label: "Bo Chen" });
  });

  it("leaves Mine out while the current user is unknown", () => {
    expect(assigneeFilterOptions([], null)).toEqual([{ value: "all", label: "All" }]);
  });

  it("falls back to All for a pick that is no longer an option", () => {
    const options = assigneeFilterOptions([{ assignee: ME, open: true }], ME);
    expect(knownFilter("person:bo@shop.io", options)).toBe("all");
    expect(knownFilter("mine", options)).toBe("mine");
  });
});

describe("pickerChoices", () => {
  it("lists the known people, then anyone assigned who is not among them", () => {
    const choices = pickerChoices([ANN, BO], ["ann@shop.io", "new.person@shop.io", undefined, "New.Person@shop.io"]);
    expect(choices.map((c) => c.id)).toEqual([ME, BO.id, "new.person@shop.io"]);
  });
});

describe("assigneeFromInput", () => {
  it("saves a known person's id when their email is typed", () => {
    expect(assigneeFromInput(" bo@shop.io ", [ANN, BO])).toBe(BO.id);
  });

  it("saves anything else as typed, trimmed, for someone not in the repository", () => {
    expect(assigneeFromInput("  new.person@shop.io ", [ANN, BO])).toBe("new.person@shop.io");
    expect(assigneeFromInput("octocat", [ANN, BO])).toBe("octocat");
  });

  it("saves empty to clear the assignee", () => {
    expect(assigneeFromInput("   ", [ANN])).toBe("");
  });
});

describe("personLabel", () => {
  it("shows the name, else the email, else the text", () => {
    expect(personLabel(ME)).toBe("Ann Lee");
    expect(personLabel("<ann@shop.io>")).toBe("ann@shop.io");
    expect(personLabel("ann@shop.io")).toBe("ann@shop.io");
  });
});
