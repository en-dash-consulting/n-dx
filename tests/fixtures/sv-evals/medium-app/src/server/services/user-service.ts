import type { User } from "../../shared/types.js";
import { validateUser } from "../../shared/utils/validate.js";
import { createUserModel } from "../models/user.js";

const store = new Map<string, User>();

export async function listUsers(): Promise<User[]> {
  return [...store.values()];
}

export async function getUserById(id: string): Promise<User | null> {
  return store.get(id) ?? null;
}

export async function createUser(input: unknown): Promise<User> {
  if (!validateUser(input)) throw new Error("invalid user");
  const user = createUserModel(input);
  store.set(user.id, user);
  return user;
}
