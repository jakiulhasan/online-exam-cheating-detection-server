import app from "../src/app.js";
import { connectDB } from "../src/db.js";
import { initFirebaseAdmin } from "../src/firebaseAdmin.js";

let initialization;

function initialize() {
  if (!initialization) {
    initFirebaseAdmin();
    initialization = connectDB().catch((err) => {
      initialization = undefined;
      throw err;
    });
  }
  return initialization;
}

export default async function handler(req, res) {
  try {
    await initialize();
    return app(req, res);
  } catch (err) {
    console.error("❌ Server initialization failed:", err.message);
    return res.status(500).json({ error: "Server initialization failed" });
  }
}