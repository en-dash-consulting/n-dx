import type { Post } from "../../shared/types.js";
import { validatePost } from "../../shared/utils/validate.js";
import { createPostModel } from "../models/post.js";

const store = new Map<string, Post>();

export async function listPosts(): Promise<Post[]> {
  return [...store.values()];
}

export async function getPostById(id: string): Promise<Post | null> {
  return store.get(id) ?? null;
}

export async function createPost(input: unknown): Promise<Post> {
  if (!validatePost(input)) throw new Error("invalid post");
  const post = createPostModel(input);
  store.set(post.id, post);
  return post;
}
