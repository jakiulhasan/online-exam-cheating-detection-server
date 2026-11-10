import { Router } from "express";
import { collections } from "../db.js";
import { verifyToken } from "../middleware/verifyToken.js";
import { verifyRole } from "../middleware/verifyRole.js";

const router = Router();

router.get("/me", verifyToken, verifyRole("student"), async (req, res, next) => {
  try {
    const studentEmail = req.user.email.toLowerCase();
    const studentResults = await collections
      .results()
      .find({ studentEmail }, { projection: { _id: 0 } })
      .sort({ submittedAt: -1 })
      .limit(100)
      .toArray();
    if (!studentResults.length) return res.json([]);

    const roomCodes = [...new Set(studentResults.map((result) => result.roomCode))];
    const scoreboards = await collections
      .results()
      .find(
        { roomCode: { $in: roomCodes } },
        {
          projection: {
            _id: 0,
            roomCode: 1,
            studentEmail: 1,
            studentName: 1,
            photoURL: 1,
            score: 1,
            total: 1,
            submittedAt: 1,
          },
        },
      )
      .sort({ score: -1, submittedAt: 1 })
      .toArray();

    const resultsByRoom = new Map();
    for (const result of scoreboards) {
      const scoreboard = resultsByRoom.get(result.roomCode) || [];
      scoreboard.push(result);
      resultsByRoom.set(result.roomCode, scoreboard);
    }

    res.json(
      studentResults.map((result) => {
        const scoreboard = resultsByRoom.get(result.roomCode) || [];
        return {
          ...result,
          rank:
            scoreboard.findIndex(
              (entry) => entry.studentEmail === studentEmail,
            ) + 1,
          scoreboard,
        };
      }),
    );
  } catch (err) {
    next(err);
  }
});

export default router;
