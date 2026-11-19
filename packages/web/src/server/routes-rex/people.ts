/**
 * `GET /api/rex/people` — who an item can be assigned to, and who "me" is.
 *
 * The known people are the repository's git authors and, on a v2 project, the
 * product layer's stewards (the root list and each area's), one entry per
 * person keyed by email (`identityKey`). A git author's id is `Name <email>`,
 * the form rex's `resolveActor` gives, so picking yourself saves the value
 * `ndx work --mine` selects by. `me` is that `resolveActor` identity.
 *
 * Read-only: it runs `git shortlog` and reads the PRD, and writes nothing.
 *
 * @module web/server/routes-rex/people
 */

import type { ServerResponse } from "node:http";
import { exec } from "@n-dx/llm-client";
import type { ServerContext } from "../types.js";
import { jsonResponse } from "../response-utils.js";
import { loadPrdModel, prdLayout, resolveActor, type RuleNode } from "../rex-gateway.js";
import { identityKey, parseIdentity, type KnownPerson, type PersonSource } from "../../shared/index.js";

/** The answer of `GET /api/rex/people`. */
export interface PeopleAnswer {
  /** The current user as `ndx work --mine` resolves them; null when it could not tell. */
  me: string | null;
  people: KnownPerson[];
}

/** `git shortlog -sne` lines (`   12\tAnn <ann@x.io>`) as identities, most commits first. */
export function parseShortlog(out: string): string[] {
  return out.split(/\r?\n/)
    .map((line) => /^\s*\d+\t(.+)$/.exec(line)?.[1]?.trim())
    .filter((id): id is string => !!id);
}

/**
 * One entry per person, keyed by email. A person seen as a git author and as a
 * steward is one entry with both sources. The current user's (`me`) spelling
 * wins outright: it is the exact string `ndx work --mine` matches, so picking
 * or typing yourself must save it, not the shortlog's spelling of the same
 * email. Otherwise the first `Name <email>` seen wins. Sorted by name, then email.
 */
export function mergePeople(entries: ReadonlyArray<{ id: string; source: PersonSource }>): KnownPerson[] {
  const byKey = new Map<string, KnownPerson>();
  for (const { id: raw, source } of entries) {
    const id = raw.trim();
    if (!id) continue;
    const key = identityKey(id);
    const { name, email } = parseIdentity(id);
    const known = byKey.get(key);
    if (!known) {
      byKey.set(key, { id, ...(name ? { name } : {}), ...(email ? { email } : {}), sources: [source] });
      continue;
    }
    const isMe = known.sources.includes("me");
    if (!known.sources.includes(source)) known.sources.push(source);
    if (source === "me") {
      byKey.set(key, { id, ...(name ? { name } : {}), ...(email ? { email } : {}), sources: known.sources });
      continue;
    }
    if (isMe) continue;
    if (!known.name && name) {
      known.name = name;
      // A name and an email together are the form `resolveActor` gives.
      if (email) known.id = id;
    }
    if (!known.email && email) known.email = email;
  }
  const label = (p: KnownPerson) => (p.name ?? p.email ?? p.id).toLowerCase();
  return [...byKey.values()].sort((a, b) => label(a).localeCompare(label(b)) || a.id.localeCompare(b.id));
}

/** Every steward the product layer names: the root list, then each area's. */
export function stewardsOf(header: Record<string, unknown> | undefined, product: readonly RuleNode[]): string[] {
  const out: string[] = [];
  const add = (list: unknown) => {
    if (Array.isArray(list)) for (const s of list) if (typeof s === "string") out.push(s);
  };
  add(header?.stewards);
  const visit = (nodes: readonly RuleNode[]) => {
    for (const node of nodes) {
      if (node.type === "area") add(node.stewards);
      if (node.children) visit(node.children);
    }
  };
  visit(product);
  return out;
}

async function gitAuthors(projectDir: string): Promise<string[]> {
  const result = await exec("git", ["shortlog", "-sne", "HEAD"], { cwd: projectDir, timeout: 10_000 });
  // Not a repository, no commits yet, or no git: nobody to list from history.
  if (result.exitCode !== 0 || result.error) return [];
  return parseShortlog(result.stdout);
}

async function productStewards(rexDir: string): Promise<string[]> {
  try {
    if ((await prdLayout(rexDir)) !== "v2") return [];
    const model = await loadPrdModel(rexDir);
    return stewardsOf(model.header, model.tree.product);
  } catch {
    // An unreadable tree leaves the git authors; the PRD reads report the error.
    return [];
  }
}

/** Handle `GET /api/rex/people`. Returns false for any other request. */
export function routePeople(
  path: string,
  method: string,
  res: ServerResponse,
  ctx: ServerContext,
): boolean | Promise<boolean> {
  if (path !== "people" || method !== "GET") return false;
  return (async () => {
    const [authors, stewards, actor] = await Promise.all([
      gitAuthors(ctx.projectDir),
      productStewards(ctx.rexDir),
      resolveActor(ctx.projectDir),
    ]);
    const me = actor && actor !== "unknown" ? actor : null;
    const answer: PeopleAnswer = {
      me,
      // The current user leads, so their exact identity is the one saved for
      // their email even when they have no commits yet.
      people: mergePeople([
        ...(me ? [{ id: me, source: "me" as const }] : []),
        ...authors.map((id) => ({ id, source: "git" as const })),
        ...stewards.map((id) => ({ id, source: "steward" as const })),
      ]),
    };
    jsonResponse(res, 200, answer);
    return true;
  })();
}
