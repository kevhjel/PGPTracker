/**
 * Single-admin auth: one owner, checked against an env-configured secret
 * (set via `npx convex env set ADMIN_SECRET ...`). No accounts/sessions -
 * this app has exactly one privileged user.
 */
export function requireAdmin(secret: string): void {
  const expected = process.env.ADMIN_SECRET;
  if (!expected) {
    throw new Error("ADMIN_SECRET is not configured on this deployment");
  }
  if (secret !== expected) {
    throw new Error("Unauthorized");
  }
}
