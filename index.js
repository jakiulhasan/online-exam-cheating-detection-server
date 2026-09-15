import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";

import { connectDB } from "./src/db.js";
import { initFirebaseAdmin } from "./src/firebaseAdmin.js";
import usersRouter from "./src/routes/users.js";
import roomsRouter from "./src/routes/rooms.js";
import violationsRouter from "./src/routes/violations.js";

const app = express();
const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";

app.use(
  cors({
    origin: CORS_ORIGIN.split(",").map((s) => s.trim()),
    credentials: true,
  }),
);
app.use(express.json());
app.use(morgan("dev"));

// Health check
app.get("/", (req, res) => {
  res.json({
    service: "MedhaGuard API",
    status: "ok",
    time: new Date().toISOString(),
  });
});

app.use("/users", usersRouter);
app.use("/rooms", roomsRouter);
app.use("/exams", violationsRouter);

// 404
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Central error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("💥", err);
  if (err?.code === 11000) {
    return res
      .status(409)
      .json({ error: "Duplicate key", detail: err.keyValue });
  }
  res.status(500).json({ error: "Internal server error" });
});

async function start() {
  initFirebaseAdmin();
  try {
    await connectDB();
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    console.error("   Check MONGODB_URI in .env (is mongod running?).");
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log(`🚀 MedhaGuard API listening on http://localhost:${PORT}`);
    console.log(`   CORS origin: ${CORS_ORIGIN}`);
  });
}

start();
