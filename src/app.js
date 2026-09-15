import express from "express";
import cors from "cors";
import morgan from "morgan";

import usersRouter from "./routes/users.js";
import roomsRouter from "./routes/rooms.js";
import violationsRouter from "./routes/violations.js";

const app = express();
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";

app.use(
  cors({
    origin: CORS_ORIGIN.split(",").map((origin) => origin.trim()),
    credentials: true,
  }),
);
app.use(express.json());
app.use(morgan("dev"));

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

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, req, res, next) => {
  console.error("💥", err);
  if (err?.code === 11000) {
    return res
      .status(409)
      .json({ error: "Duplicate key", detail: err.keyValue });
  }
  res.status(500).json({ error: "Internal server error" });
});

export default app;