import { collections } from "../db.js";

// Ensures the authenticated user (req.user from verifyToken) has an allowed role.
// Usage: router.post("/", verifyToken, verifyRole("teacher"), handler)
export function verifyRole(...allowed) {
  return async (req, res, next) => {
    try {
      const email = req.user?.email;
      if (!email) return res.status(401).json({ error: "Unauthenticated" });

      const user = await collections.users().findOne({ email });
      if (!user) return res.status(404).json({ error: "User not found" });
      if (!allowed.includes(user.role)) {
        return res.status(403).json({ error: "Forbidden: insufficient role" });
      }

      req.dbUser = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}
