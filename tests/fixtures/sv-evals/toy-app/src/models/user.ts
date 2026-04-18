import type { User } from "../types.js";

export function createUser(id: string, name: string, email: string): User {
  return { id, name, email };
}

export function isValidUser(user: unknown): user is User {
  if (!user || typeof user !== "object") return false;
  const u = user as Record<string, unknown>;
  return typeof u.id === "string" && typeof u.name === "string" && typeof u.email === "string";
}
