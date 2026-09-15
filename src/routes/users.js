import { Router } from "express";
import { collections } from "../db.js";
import { verifyToken } from "../middleware/verifyToken.js";

const router = Router();

// Create or update the current user's record.
// The email in the body MUST match the verified token's email.
router.post("/", verifyToken, async (req, res, next) => {
  try {
    const { name, email, role, photoURL, profileComplete } = req.body || {};
    if (!email || !name) {
      return res.status(400).json({ error: "name and email are required" });
    }
    if (email !== req.user.email) {
      return res.status(403).json({ error: "Email does not match token" });
    }
    const safeRole = role === "teacher" ? "teacher" : "student";
    const existingUser = await collections.users().findOne({ email });

    const now = new Date();
    const update = {
      $set: {
        name,
        photoURL: photoURL || null,
        profileComplete: profileComplete === true,
        updatedAt: now,
      },
      $setOnInsert: { email, role: safeRole, createdAt: now },
    };

    // A role can be chosen during first-time profile completion, but cannot be
    // changed after the profile has been completed.
    if (existingUser && existingUser.profileComplete !== true) {
      update.$set.role = safeRole;
    }

    const result = await collections.users().findOneAndUpdate(
      { email },
      update,
      { upsert: true, returnDocument: "after" },
    );

    const doc = result?.value ?? result;
    res.status(201).json(doc);
  } catch (err) {
    next(err);
  }
});

// Get a user's role.
router.get("/:email/role", verifyToken, async (req, res, next) => {
  try {
    const user = await collections
      .users()
      .findOne({ email: req.params.email }, { projection: { role: 1, _id: 0 } });
    res.json({ role: user?.role || "student" });
  } catch (err) {
    next(err);
  }
});

// Get a user's profile.
router.get("/:email", verifyToken, async (req, res, next) => {
  try {
    const user = await collections
      .users()
      .findOne({ email: req.params.email }, { projection: { _id: 0 } });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

export default router;
