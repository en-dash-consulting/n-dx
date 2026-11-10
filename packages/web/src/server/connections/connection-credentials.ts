/**
 * The one module in the web package that reads or writes the per-user
 * credential store (tests/unit/server/connections/connection-policy.test.ts
 * enforces it). A connection's token is the store entry `connection:<id>`;
 * it is read on every connect and never cached on disk, logged or returned
 * from a route — callers show {@link connectionTokenFingerprint} at most.
 */

import {
  credentialFingerprint,
  setCredential,
  storedCredential,
  unsetCredential,
  type CredentialStoreOptions,
} from "@n-dx/llm-client";

/** The store entry holding connection `id`'s token. */
export function connectionCredentialName(id: string): string {
  return `connection:${id}`;
}

/**
 * Connection `id`'s token from the store alone (no environment variable can
 * supply one), or undefined when none is stored or its helper fails.
 */
export function connectionToken(id: string, options: CredentialStoreOptions = {}): string | undefined {
  return storedCredential(connectionCredentialName(id), options)?.value;
}

/**
 * Connection `id`'s entry parsed as a JSON object (an OAuth connection keeps
 * its client registration and tokens there), or undefined when none is stored
 * or it is not one. Read fresh on every call: another process may have
 * rotated it.
 */
export function connectionCredentialRecord(id: string, options: CredentialStoreOptions = {}): Record<string, unknown> | undefined {
  const value = connectionToken(id, options);
  if (!value?.startsWith("{")) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Store `record` as connection `id`'s entry, replacing what was there. */
export function setConnectionCredentialRecord(id: string, record: Record<string, unknown>, options: CredentialStoreOptions = {}): void {
  setCredential(connectionCredentialName(id), JSON.stringify(record), options);
}

/**
 * Store `token` as connection `id`'s entry, replacing what was there. Throws
 * (without the value in the message) for an empty or multi-line token.
 */
export function setConnectionToken(id: string, token: string, options: CredentialStoreOptions = {}): void {
  setCredential(connectionCredentialName(id), token, options);
}

/** Remove connection `id`'s entry (and the origin it was bound to); whether there was one. */
export function unsetConnectionCredential(id: string, options: CredentialStoreOptions = {}): boolean {
  unsetCredential(connectionOriginName(id), options);
  return unsetCredential(connectionCredentialName(id), options);
}

/** The store entry holding the origin connection `id`'s credential was stored for. */
function connectionOriginName(id: string): string {
  return `connection-origin:${id}`;
}

/** The origin (scheme, host, port) of `url`, or undefined when it is not a URL. */
function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/**
 * Bind connection `id`'s stored credential to the server at `url`, so it is
 * never sent anywhere else: removing a connection keeps its credential, and
 * the same id may later be declared at another server.
 */
export function bindConnectionCredential(id: string, url: string, options: CredentialStoreOptions = {}): void {
  const origin = originOf(url);
  if (origin) setCredential(connectionOriginName(id), origin, options);
}

/**
 * The origin the credential kept for `id` was stored for when it is not
 * `url`'s, else undefined. An entry stored before binding existed carries no
 * origin and is used as before.
 */
export function connectionCredentialBoundElsewhere(id: string, url: string, options: CredentialStoreOptions = {}): string | undefined {
  const bound = storedCredential(connectionOriginName(id), options)?.value;
  return bound && bound !== originOf(url) ? bound : undefined;
}

/** Every secret an entry holds: the token itself, or an OAuth record's tokens and client secret. */
function connectionSecrets(id: string, options: CredentialStoreOptions): string[] {
  const value = connectionToken(id, options);
  if (!value) return [];
  const record = connectionCredentialRecord(id, options);
  if (!record) return [value];
  const secrets: string[] = [];
  const collect = (node: unknown, key: string): void => {
    if (typeof node === "string") {
      if (/token|secret/i.test(key) && node.length >= 8) secrets.push(node);
    } else if (node && typeof node === "object") {
      for (const [name, child] of Object.entries(node)) collect(child, name);
    }
  };
  collect(record, "");
  return secrets;
}

/**
 * `text` with every secret connection `id`'s entry holds replaced by its
 * fingerprint, for text that may echo one (a server's error body) before it
 * is stored or shown.
 */
export function withoutConnectionToken(id: string, text: string, options: CredentialStoreOptions = {}): string {
  return withoutSecrets(connectionSecrets(id, options), text);
}

/** `text` with each of `secrets` replaced by its fingerprint. */
export function withoutSecrets(secrets: Iterable<string>, text: string): string {
  let out = text;
  for (const secret of secrets) out = out.split(secret).join(`[token ${credentialFingerprint(secret)}]`);
  return out;
}

/** An 8-character fingerprint of connection `id`'s token, or null when none is stored. */
export function connectionTokenFingerprint(id: string, options: CredentialStoreOptions = {}): string | null {
  const token = connectionToken(id, options);
  return token ? credentialFingerprint(token) : null;
}
