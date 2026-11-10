import { Router } from "express";
import { collections } from "../db.js";
import { verifyToken } from "../middleware/verifyToken.js";
import { verifyRole } from "../middleware/verifyRole.js";

const router = Router();
const SUBMISSION_GRACE_MS = 10 * 1000;

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

async function completeRoomIfExpired(room) {
  if (room?.status !== "in-progress") return room;

  const startedAt = new Date(room.startedAt).getTime();
  const durationMinutes = Number(room.durationMinutes);
  if (
    !Number.isFinite(startedAt) ||
    !Number.isFinite(durationMinutes) ||
    durationMinutes < 1
  ) {
    return room;
  }

  const endedAtMs = startedAt + durationMinutes * 60 * 1000;
  const now = Date.now();
  if (now < endedAtMs) return room;

  const students = Array.isArray(room.students) ? room.students : [];
  const studentEmails = [
    ...new Set(
      students
        .map((student) => student.email?.toLowerCase())
        .filter(Boolean),
    ),
  ];

  await collections.rooms().updateOne(
    { code: room.code, status: "in-progress", startedAt: room.startedAt },
    {
      $set: {
        status: "completed",
        students: [],
        participants: studentEmails,
        endedAt: new Date(endedAtMs),
        updatedAt: new Date(),
      },
    },
  );
  return collections.rooms().findOne(
    { code: room.code },
    { projection: { _id: 0 } },
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
    const currentRooms = await Promise.all(
      rooms.map((room) => completeRoomIfExpired(room)),
    );
    res.json(
      currentRooms.map((room) => {
        const isTeacher = room.teacherEmail?.toLowerCase() === email;
        if (isTeacher) {
          const {
            participants,
            questions,
            notices,
            chat,
            ...teacherRoom
          } = room;
          return teacherRoom;
        }

        const isMember = (room.students || []).some(
          (student) => student.email?.toLowerCase() === email,
        );
        const isAssigned = (room.allowedStudentEmails || []).includes(email);
        const {
          allowedStudentEmails,
          participants,
          questions,
          notices,
          chat,
          ...studentRoom
        } = room;
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
    let room = await collections
      .rooms()
      .findOne({ code: req.params.code }, { projection: { _id: 0 } });
    if (!room) return res.status(404).json({ error: "Room not found" });
    room = await completeRoomIfExpired(room);

    const isTeacher = room.teacherEmail?.toLowerCase() === req.user.email.toLowerCase();
    const isStudent = (room.students || []).some(
      (student) => student.email?.toLowerCase() === req.user.email.toLowerCase(),
    );
    const isFormerParticipant = (room.participants || []).includes(
      req.user.email.toLowerCase(),
    );

    if (!isTeacher && !isStudent && !(room.status === "completed" && isFormerParticipant)) {
      return res.status(403).json({ error: "You are not a member of this room" });
    }

    if (isTeacher) return res.json(room);

    if (room.status === "completed") {
      const completedRoom = { ...room };
      delete completedRoom.questions;
      delete completedRoom.notices;
      delete completedRoom.chat;
      delete completedRoom.participants;
      return res.json({ ...completedRoom, questions: [], notices: [], chat: [] });
    }

    res.json({
      ...room,
      questions: (room.questions || [])
        .filter((question) => question && typeof question === "object")
        .map(({ answer, ...question }) => question),
    });
  } catch (err) {
    next(err);
  }
});

// Teacher views the scoreboard for an exam they own.
router.get(
  "/:code/results",
  verifyToken,
  verifyRole("teacher"),
  async (req, res, next) => {
    try {
      const code = req.params.code.toUpperCase();
      let room = await collections.rooms().findOne(
        { code },
        { projection: { _id: 0, code: 1, title: 1, subject: 1, status: 1 } },
      );
      if (!room) return res.status(404).json({ error: "Room not found" });

      const owner = await collections.rooms().findOne(
        { code, teacherEmail: req.user.email.toLowerCase() },
        { projection: { _id: 1 } },
      );
      if (!owner) {
        return res.status(403).json({ error: "Only the room owner can view results" });
      }
      const fullRoom = await collections.rooms().findOne({ code });
      const currentRoom = await completeRoomIfExpired(fullRoom);
      room = {
        code: currentRoom.code,
        title: currentRoom.title,
        subject: currentRoom.subject,
        status: currentRoom.status,
      };

      const results = await collections
        .results()
        .find(
          { roomCode: code },
          {
            projection: {
              _id: 0,
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
      res.json({ room, results });
    } catch (err) {
      next(err);
    }
  },
);

// Student joins a room.
router.post(
  "/:code/join",
  verifyToken,
  verifyRole("student"),
  async (req, res, next) => {
  try {
    const { name } = req.body || {};
    let room = await collections.rooms().findOne({ code: req.params.code });
    if (!room) return res.status(404).json({ error: "Room not found" });
    room = await completeRoomIfExpired(room);

    const joinDeadline = new Date(room.scheduledAt).getTime() + 5 * 60 * 1000;
    if (
      !Number.isFinite(joinDeadline) ||
      Date.now() >= joinDeadline ||
      room.status === "in-progress" ||
      room.status === "completed"
    ) {
      return res.status(409).json({ error: "This exam has already started. Joining is closed." });
    }

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

// Teacher saves the complete question list before the exam starts.
router.post(
  "/:code/questions",
  verifyToken,
  verifyRole("teacher"),
  async (req, res, next) => {
    try {
      const code = req.params.code.toUpperCase();
      const questions = req.body?.questions;
      if (!Array.isArray(questions) || questions.length < 1 || questions.length > 100) {
        return res.status(400).json({ error: "Add between 1 and 100 questions" });
      }

      const normalizedQuestions = [];
      for (const [index, item] of questions.entries()) {
        const question = safeText(item?.question);
        const options = Array.isArray(item?.options)
          ? item.options.map(safeText)
          : [];
        const answer = item?.answer;
        if (
          !question ||
          question.length > 2000 ||
          options.length < 2 ||
          options.length > 52 ||
          options.some((option) => !option || option.length > 500) ||
          !Number.isInteger(answer) ||
          answer < 0 ||
          answer >= options.length
        ) {
          return res.status(400).json({
            error: `Question ${index + 1} needs text, at least two options, and a valid answer`,
          });
        }
        normalizedQuestions.push({ question, options, answer });
      }

      const room = await collections.rooms().findOne({ code });
      if (!room) return res.status(404).json({ error: "Room not found" });
      if (room.teacherEmail?.toLowerCase() !== req.user.email.toLowerCase()) {
        return res.status(403).json({ error: "Only the room owner can edit questions" });
      }
      if (room.status !== "waiting") {
        return res.status(409).json({ error: "Questions cannot be changed after the exam starts" });
      }

      const update = await collections.rooms().updateOne(
        { code, status: "waiting" },
        { $set: { questions: normalizedQuestions, updatedAt: new Date() } },
      );
      if (!update.matchedCount) {
        return res.status(409).json({ error: "Questions cannot be changed after the exam starts" });
      }
      res.json({ ok: true, questions: normalizedQuestions });
    } catch (err) {
      next(err);
    }
  },
);

// Score and persist one result per student for an exam.
router.post("/:code/submit", verifyToken, async (req, res, next) => {
  try {
    const code = req.params.code.toUpperCase();
    let room = await collections.rooms().findOne({ code });
    if (!room) return res.status(404).json({ error: "Room not found" });
    room = await completeRoomIfExpired(room);
    if (room.teacherEmail?.toLowerCase() === req.user.email.toLowerCase()) {
      return res.status(403).json({ error: "Teachers cannot submit student answers" });
    }
    const studentEmail = req.user.email.toLowerCase();
    const isCurrentMember = (room.students || []).some(
      (student) => student.email?.toLowerCase() === studentEmail,
    );
    const isCompletedParticipant =
      room.status === "completed" &&
      (room.participants || []).includes(studentEmail);
    if (isCompletedParticipant) {
      const endTime =
        new Date(room.startedAt).getTime() +
        Number(room.durationMinutes) * 60 * 1000;
      if (Date.now() > endTime + SUBMISSION_GRACE_MS) {
        const existingResult = await collections.results().findOne({
          roomCode: code,
          studentEmail,
        });
        if (!existingResult) {
          return res.status(409).json({ error: "The exam submission period has ended" });
        }
      }
    }
    if (!isCurrentMember && !isCompletedParticipant) {
      return res.status(403).json({ error: "You must join this room first" });
    }
    if (room.status !== "in-progress" && !isCompletedParticipant) {
      return res.status(409).json({ error: "This exam is not in progress" });
    }
    if (!Array.isArray(room.questions) || !room.questions.length) {
      return res.status(409).json({ error: "This exam has no questions" });
    }

    const answers = req.body?.answers;
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
      return res.status(400).json({ error: "answers must be an object" });
    }
    for (const [questionIndex, optionIndex] of Object.entries(answers)) {
      const index = Number(questionIndex);
      if (
        !/^(0|[1-9]\d*)$/.test(questionIndex) ||
        index >= room.questions.length ||
        !Number.isInteger(optionIndex) ||
        optionIndex < 0 ||
        optionIndex >= room.questions[index].options.length
      ) {
        return res.status(400).json({ error: "answers contains an invalid selection" });
      }
    }

    const score = room.questions.reduce(
      (total, question, index) =>
        answers[index] === question.answer ? total + 1 : total,
      0,
    );
    const student = (room.students || []).find(
      (item) => item.email?.toLowerCase() === studentEmail,
    );
    const profile = await collections.users().findOne(
      { email: studentEmail },
      { projection: { _id: 0, name: 1, photoURL: 1 } },
    );
    const result = {
      roomCode: code,
      roomTitle: room.title,
      subject: room.subject,
      studentEmail,
      studentName:
        profile?.name ||
        student?.name ||
        studentEmail.split("@")[0],
      photoURL: profile?.photoURL || null,
      score,
      total: room.questions.length,
      submittedAt: new Date(),
    };

    try {
      await collections.results().updateOne(
        { roomCode: code, studentEmail },
        { $setOnInsert: result },
        { upsert: true },
      );
    } catch (err) {
      if (err?.code !== 11000) throw err;
    }

    const savedResult = await collections.results().findOne(
      { roomCode: code, studentEmail },
      { projection: { _id: 0, score: 1, total: 1, submittedAt: 1 } },
    );
    res.json(savedResult);
  } catch (err) {
    next(err);
  }
});

// Teacher starts the exam for every student in the room at one shared time.
router.post(
  "/:code/start",
  verifyToken,
  verifyRole("teacher"),
  async (req, res, next) => {
    try {
      const code = req.params.code.toUpperCase();
      let room = await collections.rooms().findOne({ code });
      if (!room) return res.status(404).json({ error: "Room not found" });
      room = await completeRoomIfExpired(room);
      if (room.teacherEmail?.toLowerCase() !== req.user.email.toLowerCase()) {
        return res.status(403).json({ error: "Only the room owner can start this exam" });
      }
      if (!Array.isArray(room.questions) || room.questions.length === 0) {
        return res.status(409).json({ error: "Add questions before starting the exam" });
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

      let room = await collections.rooms().findOne({ code: req.params.code });
      if (!room) return res.status(404).json({ error: "Room not found" });
      room = await completeRoomIfExpired(room);
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

    let room = await collections.rooms().findOne({ code: req.params.code });
    if (!room) return res.status(404).json({ error: "Room not found" });
    room = await completeRoomIfExpired(room);

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
