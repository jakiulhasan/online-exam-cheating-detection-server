import { Router } from "express";
import { collections } from "../db.js";
import { verifyToken } from "../middleware/verifyToken.js";
import { verifyRole } from "../middleware/verifyRole.js";

const router = Router();

// Student client logs a proctoring violation during an exam.
router.post("/:roomId/violations", verifyToken, async (req, res, next) => {
  try {
    const { type, detail, ts } = req.body || {};
    if (!type) return res.status(400).json({ error: "type is required" });
    const doc = {
      roomId: req.params.roomId,
      studentEmail: req.user.email,
      type,
      detail: detail || null,
      ts: ts ? new Date(ts) : new Date(),
    };
    await collections.violations().insertOne(doc);
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Teacher reviews violations for a room.
router.get(
  "/:roomId/violations",
  verifyToken,
  verifyRole("teacher"),
  async (req, res, next) => {
    try {
      const list = await collections
        .violations()
        .find({ roomId: req.params.roomId }, { projection: { _id: 0 } })
        .sort({ ts: -1 })
        .toArray();
      res.json(list);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
