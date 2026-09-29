import { Router } from "express";
import { collections } from "../db.js";
import { verifyToken } from "../middleware/verifyToken.js";
import { verifyRole } from "../middleware/verifyRole.js";

const router = Router();

function genCode() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

function safeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmails(values) {
  return [...new Set(values.map((value) => safeText(value).toLowerCase()))];
}

function isRoomMember(room, userEmail) {
  if (!room || !userEmail) return false;
  const email = userEmail.toLowerCase();
  if (room.teacherEmail?.toLowerCase() === email) return true;
  return (room.students || []).some(
    (student) => student.email?.toLowerCase() === email,
  );
}

// An empty invite list makes the exam joinable by anyone with its room code.
router.post("/", verifyToken, verifyRole("teacher"), async (req, res, next) => {
  try {
    const title = safeText(req.body?.title);
    const subject = safeText(req.body?.subject);
    const instructions = safeText(req.body?.instructions);
    const type = req.body?.type === "Written" ? "Written" : "MCQ";
    const scheduledAt = new Date(req.body?.scheduledAt);
    const durationMinutes = Number(req.body?.durationMinutes);
    const allowedStudentEmails = normalizeEmails(
      Array.isArray(req.body?.allowedStudentEmails)
        ? req.body.allowedStudentEmails
        : [],
    );
    const invalidEmails = allowedStudentEmails.filter(
      (email) => !/^[^\s@]+@gmail\.com$/.test(email),
    );

    if (!title || !subject) {
      return res.status(400).json({ error: "Exam title and subject are required" });
    }
    if (Number.isNaN(scheduledAt.getTime())) {
      return res.status(400).json({ error: "A valid exam date and time are required" });
    }
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 360) {
      return res.status(400).json({ error: "Duration must be between 1 and 360 minutes" });
    }
    if (invalidEmails.length) {
      return res.status(400).json({ error: "Enter valid Gmail addresses" });
    }

    const room = {
      code: genCode(),
      title,
      subject,
      instructions,
      type,
      scheduledAt,
      durationMinutes,
      allowedStudentEmails,
      teacherEmail: req.user.email.toLowerCase(),
      students: [],
      notices: [],
      chat: [],
      chatEnabled: true,
      status: "waiting",
      questions: Array.isArray(req.body?.questions) ? req.body.questions : [],
      createdAt: new Date(),
      updatedAt: new Date(),
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
    const email = req.user.email.toLowerCase();
    const rooms = await collections
      .rooms()
      .find(
        {
          $or: [
            { teacherEmail: email },
            { "students.email": email },
            { allowedStudentEmails: email },
          ],
        },
        { projection: { _id: 0, questions: 0, notices: 0, chat: 0 } },
      )
      .sort({ createdAt: -1 })
      .toArray();
    res.json(
      rooms.map((room) => {
        const isTeacher = room.teacherEmail?.toLowerCase() === email;
        if (isTeacher) return room;

        const isMember = (room.students || []).some(
          (student) => student.email?.toLowerCase() === email,
        );
        const isAssigned = (room.allowedStudentEmails || []).includes(email);
        const { allowedStudentEmails, ...studentRoom } = room;
        return {
          ...studentRoom,
          students: isMember ? room.students : [],
          isAssigned: isAssigned || isMember,
        };
      }),
    );
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

    const isTeacher = room.teacherEmail?.toLowerCase() === req.user.email.toLowerCase();
    const isStudent = (room.students || []).some(
      (student) => student.email?.toLowerCase() === req.user.email.toLowerCase(),
    );

    if (!isTeacher && !isStudent) {
      return res.status(403).json({ error: "You are not a member of this room" });
    }

    res.json(room);
  } catch (err) {
    next(err);
  }
});

// Student joins a room.
router.post(
  "/:code/join",
  verifyToken,
  verifyRole("student"),
  async (req, res, next) => {
  try {
    const { name } = req.body || {};
    const room = await collections.rooms().findOne({ code: req.params.code });
    if (!room) return res.status(404).json({ error: "Room not found" });

    const email = req.user.email.toLowerCase();
    const allowedEmails = normalizeEmails(room.allowedStudentEmails || []);
    if (allowedEmails.length && !allowedEmails.includes(email)) {
      return res.status(403).json({ error: "Sorry, you are not invited for the exam, contact your teacher." });
    }

    const studentList = Array.isArray(room.students) ? room.students : [];
    const alreadyJoined = studentList.some(
      (student) => student.email?.toLowerCase() === email,
    );

    if (!alreadyJoined) {
      studentList.push({
        email,
        name: safeText(name) || email.split("@")[0],
        joinedAt: new Date(),
      });
      await collections.rooms().updateOne(
        { code: req.params.code },
        { $set: { students: studentList, updatedAt: new Date() } },
      );
    }

    const nextRoom = await collections
      .rooms()
      .findOne({ code: req.params.code }, { projection: { _id: 0 } });

    res.json({ ok: true, code: req.params.code, room: nextRoom });
  } catch (err) {
    next(err);
  }
  },
);

// Teacher starts the exam for every student in the room at one shared time.
router.post(
  "/:code/start",
  verifyToken,
  verifyRole("teacher"),
  async (req, res, next) => {
    try {
      const code = req.params.code.toUpperCase();
      const room = await collections.rooms().findOne({ code });
      if (!room) return res.status(404).json({ error: "Room not found" });
      if (room.teacherEmail?.toLowerCase() !== req.user.email.toLowerCase()) {
        return res.status(403).json({ error: "Only the room owner can start this exam" });
      }
      if (
        room.status === "waiting" ||
        (room.status === "live" && !room.startedAt)
      ) {
        await collections.rooms().updateOne(
          { code, status: room.status },
          {
            $set: {
              status: "in-progress",
              startedAt: new Date(),
              updatedAt: new Date(),
            },
          },
        );
      } else if (room.status !== "in-progress") {
        return res.status(409).json({ error: "This exam cannot be started" });
      }

      const startedRoom = await collections
        .rooms()
        .findOne({ code }, { projection: { _id: 0 } });
      res.json({ ok: true, room: startedRoom });
    } catch (err) {
      next(err);
    }
  },
);

// Teacher controls whether students can use the room chat.
router.post(
  "/:code/chat-status",
  verifyToken,
  verifyRole("teacher"),
  async (req, res, next) => {
    try {
      const code = req.params.code.toUpperCase();
      if (typeof req.body?.enabled !== "boolean") {
        return res.status(400).json({ error: "enabled must be a boolean" });
      }

      const room = await collections.rooms().findOne({ code });
      if (!room) return res.status(404).json({ error: "Room not found" });
      if (room.teacherEmail?.toLowerCase() !== req.user.email.toLowerCase()) {
        return res.status(403).json({ error: "Only the room owner can control chat" });
      }

      await collections.rooms().updateOne(
        { code },
        { $set: { chatEnabled: req.body.enabled, updatedAt: new Date() } },
      );
      res.json({ ok: true, chatEnabled: req.body.enabled });
    } catch (err) {
      next(err);
    }
  },
);

// Teacher sends a room notice.
router.post(
  "/:code/notice",
  verifyToken,
  verifyRole("teacher"),
  async (req, res, next) => {
    try {
      const message = safeText(req.body?.text);
      if (!message) return res.status(400).json({ error: "text is required" });

      const room = await collections.rooms().findOne({ code: req.params.code });
      if (!room) return res.status(404).json({ error: "Room not found" });
      if (room.teacherEmail?.toLowerCase() !== req.user.email.toLowerCase()) {
        return res.status(403).json({ error: "Only the room owner can post notices" });
      }

      const notice = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text: message,
        createdBy: req.user.email,
        createdAt: new Date(),
      };

      const updated = await collections.rooms().findOneAndUpdate(
        { code: req.params.code },
        {
          $push: { notices: { $each: [notice], $slice: -20 } },
          $set: { updatedAt: new Date() },
        },
        { returnDocument: "after", projection: { _id: 0 } },
      );

      res.status(201).json({ ok: true, notice, room: updated.value || updated });
    } catch (err) {
      next(err);
    }
  },
);

// Room chat for students and teachers.
router.post("/:code/chat", verifyToken, async (req, res, next) => {
  try {
    const message = safeText(req.body?.message);
    if (!message) return res.status(400).json({ error: "message is required" });

    const room = await collections.rooms().findOne({ code: req.params.code });
    if (!room) return res.status(404).json({ error: "Room not found" });

    if (!isRoomMember(room, req.user.email)) {
      return res.status(403).json({ error: "You must join this room first" });
    }

    const senderRole =
      room.teacherEmail?.toLowerCase() === req.user.email.toLowerCase()
        ? "teacher"
        : "student";
    if (senderRole === "student" && room.chatEnabled === false) {
      return res.status(403).json({ error: "Chat is turned off by your teacher" });
    }
    const senderProfile = await collections.users().findOne(
      { email: req.user.email },
      { projection: { name: 1, photoURL: 1, _id: 0 } },
    );
    const chatItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      senderEmail: req.user.email,
      senderName: senderProfile?.name || req.user.email.split("@")[0],
      senderPhotoURL: senderProfile?.photoURL || null,
      senderRole,
      text: message,
      createdAt: new Date(),
    };

    const updated = await collections.rooms().findOneAndUpdate(
      { code: req.params.code },
      {
        $push: { chat: { $each: [chatItem], $slice: -50 } },
        $set: { updatedAt: new Date() },
      },
      { returnDocument: "after", projection: { _id: 0 } },
    );

    res.status(201).json({ ok: true, message: chatItem, room: updated.value || updated });
  } catch (err) {
    next(err);
  }
});

export default router;
