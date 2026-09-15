import "dotenv/config";
import app from "./src/app.js";
import { connectDB } from "./src/db.js";
import { initFirebaseAdmin } from "./src/firebaseAdmin.js";
const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";

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
