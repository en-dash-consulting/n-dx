/**
 * Tests for the PRD-to-work-item linkage model operations.
 *
 * Acceptance criteria (task PRD-to-Work-Item Linkage Model):
 *   1. When a downstream work item is created, the relationship is stored on the PRD item.
 *   2. When the PRD is viewed, the linked item is visible (round-trip persistence — see
 *      folder-tree-serializer.test.ts).
 *   3. When a linked item changes status in an integrated system, the linkage reflects
 *      the latest known state (updateLinkSyncState).
 *
 * All operations are pure: they return a new PRDItem and never mutate the input.
 * Link identity is (system, workItemId).
 */

import { describe, it, expect } from "vitest";
import {
  getLinks,
  findLink,
  upsertLink,
  removeLink,
  updateLinkSyncState,
} from "../../../src/core/work-item-link.js";
import type { PRDItem, WorkItemLink } from "../../../src/schema/index.js";

function makeItem(extra: Partial<PRDItem> = {}): PRDItem {
  return { id: "t1", title: "Task", status: "pending", level: "task", ...extra };
}

const notionLink: WorkItemLink = {
  system: "notion",
  workItemId: "page-123",
  url: "https://notion.so/page-123",
  title: "Notion page",
};

const githubLink: WorkItemLink = {
  system: "github",
  workItemId: "42",
  url: "https://github.com/org/repo/issues/42",
};

describe("getLinks", () => {
  it("returns an empty array when the item has no links", () => {
    expect(getLinks(makeItem())).toEqual([]);
  });

  it("returns the links array when present", () => {
    const item = makeItem({ links: [notionLink] });
    expect(getLinks(item)).toEqual([notionLink]);
  });
});

describe("findLink", () => {
  it("finds a link by (system, workItemId)", () => {
    const item = makeItem({ links: [notionLink, githubLink] });
    expect(findLink(item, "github", "42")).toEqual(githubLink);
  });

  it("returns undefined when no link matches", () => {
    const item = makeItem({ links: [notionLink] });
    expect(findLink(item, "jira", "ABC-1")).toBeUndefined();
    // Same system, different workItemId — not a match.
    expect(findLink(item, "notion", "page-999")).toBeUndefined();
  });
});

describe("upsertLink", () => {
  it("adds a new link when none with the same identity exists (criterion 1)", () => {
    const item = makeItem();
    const next = upsertLink(item, notionLink);
    expect(getLinks(next)).toEqual([notionLink]);
  });

  it("does not mutate the input item", () => {
    const item = makeItem();
    upsertLink(item, notionLink);
    expect(item.links).toBeUndefined();
  });

  it("appends alongside links to other systems", () => {
    const item = makeItem({ links: [notionLink] });
    const next = upsertLink(item, githubLink);
    expect(getLinks(next)).toEqual([notionLink, githubLink]);
  });

  it("replaces an existing link with the same identity in place", () => {
    const item = makeItem({ links: [notionLink, githubLink] });
    const updated: WorkItemLink = { ...notionLink, title: "Renamed page" };
    const next = upsertLink(item, updated);
    // Same length (replaced, not appended), position preserved, other links intact.
    expect(getLinks(next)).toEqual([updated, githubLink]);
  });
});

describe("removeLink", () => {
  it("removes the matching link", () => {
    const item = makeItem({ links: [notionLink, githubLink] });
    const next = removeLink(item, "notion", "page-123");
    expect(getLinks(next)).toEqual([githubLink]);
  });

  it("drops the links field entirely when the last link is removed", () => {
    const item = makeItem({ links: [notionLink] });
    const next = removeLink(item, "notion", "page-123");
    expect(next.links).toBeUndefined();
  });

  it("is a no-op (new object, unchanged links) when no link matches", () => {
    const item = makeItem({ links: [notionLink] });
    const next = removeLink(item, "jira", "ABC-1");
    expect(getLinks(next)).toEqual([notionLink]);
    expect(next).not.toBe(item);
  });

  it("does not mutate the input item", () => {
    const item = makeItem({ links: [notionLink, githubLink] });
    removeLink(item, "notion", "page-123");
    expect(item.links).toEqual([notionLink, githubLink]);
  });
});

describe("updateLinkSyncState", () => {
  it("patches sync state fields on the matching link (criterion 3)", () => {
    const item = makeItem({ links: [notionLink] });
    const next = updateLinkSyncState(item, "notion", "page-123", {
      syncState: "synced",
      remoteStatus: "In progress",
      lastSyncedAt: "2026-07-09T00:00:00.000Z",
    });
    expect(findLink(next, "notion", "page-123")).toEqual({
      ...notionLink,
      syncState: "synced",
      remoteStatus: "In progress",
      lastSyncedAt: "2026-07-09T00:00:00.000Z",
    });
  });

  it("only touches the targeted link, leaving siblings untouched", () => {
    const item = makeItem({ links: [notionLink, githubLink] });
    const next = updateLinkSyncState(item, "github", "42", { syncState: "error", error: "401" });
    expect(findLink(next, "notion", "page-123")).toEqual(notionLink);
    expect(findLink(next, "github", "42")).toEqual({
      ...githubLink,
      syncState: "error",
      error: "401",
    });
  });

  it("is a no-op (new object) when no link matches", () => {
    const item = makeItem({ links: [notionLink] });
    const next = updateLinkSyncState(item, "jira", "ABC-1", { syncState: "synced" });
    expect(getLinks(next)).toEqual([notionLink]);
    expect(next).not.toBe(item);
  });

  it("does not mutate the input item", () => {
    const item = makeItem({ links: [notionLink] });
    updateLinkSyncState(item, "notion", "page-123", { syncState: "synced" });
    expect(item.links).toEqual([notionLink]);
  });
});
