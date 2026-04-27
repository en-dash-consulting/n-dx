import type { Server } from "../app.js";
import { getUserById } from "../services/user-service.js";

export function registerAuthRoutes(server: Server): void {
  server.use({
    method: "POST",
    path: "/auth/login",
    handler: async (req: { body: { userId: string; password: string } }) => {
      const user = await getUserById(req.body.userId);
      return { token: user ? `tok-${user.id}` : null };
    },
  });
  server.use({
    method: "POST",
    path: "/auth/logout",
    handler: async () => ({ ok: true }),
  });
}
