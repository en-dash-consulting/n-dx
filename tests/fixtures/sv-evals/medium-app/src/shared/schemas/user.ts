import type { User } from "../types.js";

export const userSchema = {
  type: "object",
  required: ["id", "name", "email", "createdAt"],
  properties: {
    id: { type: "string" },
    name: { type: "string", minLength: 1 },
    email: { type: "string", format: "email" },
    createdAt: { type: "string", format: "date-time" },
  },
} as const;

export function isUser(value: unknown): value is User {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.email === "string" &&
    typeof v.createdAt === "string"
  );
}
