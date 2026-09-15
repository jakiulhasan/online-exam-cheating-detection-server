import { Router } from "express";
import { collections } from "../db.js";
import { verifyToken } from "../middleware/verifyToken.js";
import { verifyRole } from "../middleware/verifyRole.js";

const router = Router();

function genCode() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

// Teacher creates an exam room.
router.post("/", verifyToken, verifyRole("teacher"), async (req, res, next) => {
  try {
    const { title, type, questions } = req.body || {};
    const room = {
      code: genCode(),
      title: title || "Untitled Exam",
      type: type === "Written" ? "Written" : "MCQ",
      teacherEmail: req.user.email,
      students: [],
      questions: Array.isArray(questions) ? questions : [],
      createdAt: new Date(),
    };
    await collections.rooms().insertOne(room);
    res.status(201).json(room);
  } catch (err) {
    next(err);
  }
});

// List rooms.
router.get("/", verifyToken, async (req, res, next) => {
  try {
    const rooms = await collections
      .rooms()
      .find({}, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(rooms);
  } catch (err) {
    next(err);
  }
});

// Get a single room by its join code.
router.get("/:code", verifyToken, async (req, res, next) => {
  try {
    const room = await collections
      .rooms()
      .findOne({ code: req.params.code }, { projection: { _id: 0 } });
    if (!room) return res.status(404).json({ error: "Room not found" });
    res.json(room);
  } catch (err) {
    next(err);
  }
});

// Student joins a room.
router.post("/:code/join", verifyToken, async (req, res, next) => {
  try {
    const result = await collections
      .rooms()
      .updateOne(
        { code: req.params.code },
        { $addToSet: { students: req.user.email } },
      );
    if (result.matchedCount === 0)
      return res.status(404).json({ error: "Room not found" });
    res.json({ ok: true, code: req.params.code });
  } catch (err) {
    next(err);
  }
});

export default router;
