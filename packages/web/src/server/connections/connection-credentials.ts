/**
 * The one module in the web package that reads or writes the per-user
 * credential store (tests/unit/server/connections/connection-policy.test.ts
 * enforces it). A connection's token is the store entry `connection:<id>`;
 * it is read on every connect and never cached on disk, logged or returned
 * from a route — callers show {@link connectionTokenFingerprint} at most.
 */

import {
  credentialFingerprint,
  storedCredential,
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
 * `text` with every occurrence of connection `id`'s token replaced by its
 * fingerprint, for text that may echo it (a server's error body) before it is
 * stored or shown.
 */
export function withoutConnectionToken(id: string, text: string, options: CredentialStoreOptions = {}): string {
  const token = connectionToken(id, options);
  return token ? text.split(token).join(`[token ${credentialFingerprint(token)}]`) : text;
}

/** An 8-character fingerprint of connection `id`'s token, or null when none is stored. */
export function connectionTokenFingerprint(id: string, options: CredentialStoreOptions = {}): string | null {
  const token = connectionToken(id, options);
  return token ? credentialFingerprint(token) : null;
}
