import type { User } from "../../shared/types.js";

export function createUserModel(input: Partial<User>): User {
  return {
    id: input.id ?? crypto.randomUUID(),
    name: input.name ?? "anonymous",
    email: input.email ?? "",
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}
