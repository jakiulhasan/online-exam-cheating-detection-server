import { admin, isFirebaseReady } from "../firebaseAdmin.js";

// Decode a JWT payload WITHOUT verifying the signature. DEV ONLY.
function unsafeDecode(token) {
  try {
    const payload = token.split(".")[1];
    const json = Buffer.from(payload, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export async function verifyToken(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing Authorization token" });
  }

  // Normal, secure path — verify signature with Firebase Admin.
  if (isFirebaseReady()) {
    try {
      const decoded = await admin.auth().verifyIdToken(token);
      req.user = { uid: decoded.uid, email: decoded.email };
      return next();
    } catch {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
  }

  // DEV-ONLY fallback: decode without verifying the signature.
  if (process.env.ALLOW_INSECURE_DEV_AUTH === "true") {
    const decoded = unsafeDecode(token);
    if (decoded?.email) {
      req.user = { uid: decoded.user_id || decoded.sub, email: decoded.email };
      console.warn(
        `⚠️  INSECURE DEV AUTH: trusting unverified token for ${decoded.email}`,
      );
      return next();
    }
  }

  return res.status(401).json({
    error:
      "Server cannot verify tokens (Firebase Admin not configured). Set FB_SERVICE_ACCOUNT, or ALLOW_INSECURE_DEV_AUTH=true for local dev.",
  });
}
