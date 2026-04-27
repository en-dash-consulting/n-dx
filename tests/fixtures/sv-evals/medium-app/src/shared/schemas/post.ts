import type { Post } from "../types.js";

export const postSchema = {
  type: "object",
  required: ["id", "title", "body", "authorId", "createdAt"],
  properties: {
    id: { type: "string" },
    title: { type: "string", minLength: 1 },
    body: { type: "string" },
    authorId: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
  },
} as const;

export function isPost(value: unknown): value is Post {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.title === "string" &&
    typeof v.body === "string" &&
    typeof v.authorId === "string" &&
    typeof v.createdAt === "string"
  );
}
