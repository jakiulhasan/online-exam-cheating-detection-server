import admin from "firebase-admin";

let initialized = false;

export function initFirebaseAdmin() {
  if (initialized) return admin;

  const raw = process.env.FB_SERVICE_ACCOUNT;
  if (raw && raw.trim()) {
    try {
      const serviceAccount = JSON.parse(raw);
      // When the JSON is pasted into a .env value, the private_key newlines
      // usually arrive escaped as "\n" — restore them.
      if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(
          /\\n/g,
          "\n",
        );
      }
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      initialized = true;
      console.log("✅ Firebase Admin initialized (token verification ON)");
    } catch (err) {
      console.error("❌ Failed to parse FB_SERVICE_ACCOUNT:", err.message);
    }
  } else {
    console.warn(
      "⚠️  FB_SERVICE_ACCOUNT not set — Firebase Admin NOT initialized.",
    );
    if (process.env.ALLOW_INSECURE_DEV_AUTH === "true") {
      console.warn(
        "⚠️  ALLOW_INSECURE_DEV_AUTH=true — tokens will be DECODED but NOT verified (dev only).",
      );
    }
  }
  return admin;
}

export function isFirebaseReady() {
  return initialized;
}

export { admin };
