export async function loggerMiddleware(
  req: { method: string; url: string },
  next: () => Promise<unknown>,
): Promise<unknown> {
  const start = Date.now();
  const result = await next();
  console.log(`${req.method} ${req.url} ${Date.now() - start}ms`);
  return result;
}
