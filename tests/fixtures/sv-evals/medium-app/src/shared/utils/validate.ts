import { isUser } from "../schemas/user.js";
import { isPost } from "../schemas/post.js";

export function validateUser(input: unknown): boolean {
  return isUser(input);
}

export function validatePost(input: unknown): boolean {
  return isPost(input);
}
