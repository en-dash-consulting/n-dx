import type { Post } from "../../shared/types.js";

export function createPostModel(input: Partial<Post>): Post {
  return {
    id: input.id ?? crypto.randomUUID(),
    title: input.title ?? "untitled",
    body: input.body ?? "",
    authorId: input.authorId ?? "",
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}
