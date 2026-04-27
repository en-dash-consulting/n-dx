export async function authMiddleware(
  req: { headers: Record<string, string>; user?: { id: string } },
  next: () => Promise<unknown>,
): Promise<unknown> {
  const token = req.headers["authorization"];
  if (token && token.startsWith("tok-")) {
    req.user = { id: token.slice(4) };
  }
  return next();
}
