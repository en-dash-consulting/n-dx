import type { Server } from "../app.js";
import { getPostById, listPosts, createPost } from "../services/post-service.js";

export function registerPostRoutes(server: Server): void {
  server.use({
    method: "GET",
    path: "/posts",
    handler: async () => listPosts(),
  });
  server.use({
    method: "GET",
    path: "/posts/:id",
    handler: async (req: { params: { id: string } }) => getPostById(req.params.id),
  });
  server.use({
    method: "POST",
    path: "/posts",
    handler: async (req: { body: unknown }) => createPost(req.body),
  });
}
