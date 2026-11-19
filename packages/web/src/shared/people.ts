/**
 * People an item can be assigned to, and how two spellings of one person are
 * told apart.
 *
 * An assignee is a free-form string, matched exactly by `ndx work --mine`
 * against rex's `resolveActor` identity (`"Name <email>"`, or the email alone).
 * The server builds the known-people list from git authors and product
 * stewards; the viewer filters rows by it. Both key a person by email, so
 * `Ann <ann@x.io>` and `ann@x.io` are one person on either side.
 *
 * @module shared/people
 */

/** Where the repository knows a person from. */
export type PersonSource = "git" | "steward";

/** One entry of `GET /api/rex/people`. */
export interface KnownPerson {
  /** What picking this person saves as the assignee. */
  id: string;
  name?: string;
  email?: string;
  sources: PersonSource[];
}

const ANGLE_EMAIL = /^(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/;
const BARE_EMAIL = /^[^\s@<>]+@[^\s@<>]+$/;

/** The name and email an identity string carries, when it carries them. */
export function parseIdentity(value: string): { name?: string; email?: string } {
  const text = value.trim();
  const angled = ANGLE_EMAIL.exec(text);
  if (angled) {
    const name = angled[1].trim();
    return { ...(name ? { name } : {}), email: angled[2] };
  }
  if (BARE_EMAIL.test(text)) return { email: text };
  return text ? { name: text } : {};
}

/**
 * The key two identity strings share when they name one person: the email,
 * lowercased, when there is one; otherwise the trimmed text, lowercased.
 */
export function identityKey(value: string): string {
  const { email } = parseIdentity(value);
  return (email ?? value.trim()).toLowerCase();
}
