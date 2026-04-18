import type { Server } from "../app.js";
import { getUserById, listUsers } from "../services/user-service.js";

export function registerUserRoutes(server: Server): void {
  server.use({
    method: "GET",
    path: "/users",
    handler: async () => listUsers(),
  });
  server.use({
    method: "GET",
    path: "/users/:id",
    handler: async (req: { params: { id: string } }) => getUserById(req.params.id),
  });
}
