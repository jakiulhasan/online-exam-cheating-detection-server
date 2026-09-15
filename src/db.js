import { MongoClient } from "mongodb";

const dbName = process.env.DB_NAME || "medhaguard";

let client;
let db;
let memoryServer;

function getMongoUri() {
  const configuredUri = process.env.MONGODB_URI;
  if (!configuredUri) return "mongodb://127.0.0.1:27017";

  const username = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  if (!username || !password) return configuredUri;

  const encodedUser = encodeURIComponent(username);
  const encodedPassword = encodeURIComponent(password);
  return configuredUri
    .replace("<user>", encodedUser)
    .replace("<pass>", encodedPassword);
}

async function tryConnect(uri, timeoutMs = 2000) {
  const c = new MongoClient(uri, { serverSelectionTimeoutMS: timeoutMs });
  await c.connect();
  // Force actual server selection so an unreachable Mongo fails fast here.
  await c.db(dbName).command({ ping: 1 });
  return c;
}

export async function connectDB() {
  if (db) return db;

  const uri = getMongoUri();

  try {
    client = await tryConnect(uri);
  } catch (err) {
    const isLocalMongo = uri.includes("127.0.0.1") || uri.includes("localhost");
    if (!isLocalMongo || process.env.NODE_ENV === "production") throw err;

    console.warn(`⚠️  Could not reach local MongoDB (${err.message}).`);
    console.warn(
      "⚠️  Starting an IN-MEMORY MongoDB for local dev — data is NOT persisted.",
    );
    console.warn(
      "    Install/point MONGODB_URI at a real MongoDB for durable storage.",
    );
    const { MongoMemoryServer } = await import("mongodb-memory-server");
    memoryServer = await MongoMemoryServer.create();
    client = await tryConnect(memoryServer.getUri());
  }

  db = client.db(dbName);

  // Helpful indexes (idempotent)
  await db.collection("users").createIndex({ email: 1 }, { unique: true });
  await db.collection("rooms").createIndex({ code: 1 }, { unique: true });
  await db.collection("violations").createIndex({ roomId: 1, ts: -1 });

  console.log(`✅ MongoDB connected → db "${dbName}"`);
  return db;
}

export async function closeDB() {
  await client?.close();
  await memoryServer?.stop();
  db = undefined;
}

export function getDb() {
  if (!db) throw new Error("DB not initialized. Call connectDB() first.");
  return db;
}

// Convenience accessors so routes don't repeat getDb().collection(...)
export const collections = {
  users: () => getDb().collection("users"),
  rooms: () => getDb().collection("rooms"),
  violations: () => getDb().collection("violations"),
};
