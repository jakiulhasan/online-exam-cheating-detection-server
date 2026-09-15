# MedhaGuard — Backend API

Express + MongoDB + Firebase Admin backend for the online exam cheating‑detection
platform (`online-exam-cheating-detection` frontend).

## Setup

```bash
npm install
cp .env.example .env   # then edit .env
npm run dev            # http://localhost:3000
```

### Environment (`.env`)

| Key                       | Description                                                                   |
| ------------------------- | ----------------------------------------------------------------------------- |
| `PORT`                    | API port (default `3000`)                                                     |
| `CORS_ORIGIN`             | Allowed frontend origin(s), comma‑separated (default `http://localhost:5173`) |
| `MONGODB_URI`             | Local `mongodb://127.0.0.1:27017` or an Atlas connection string               |
| `DB_USER`                 | Optional Atlas username when the URI contains `<user>`                        |
| `DB_PASSWORD`             | Optional Atlas password when the URI contains `<pass>`                        |
| `DB_NAME`                 | Database name (default `medhaguard`)                                          |
| `FB_SERVICE_ACCOUNT`      | Firebase service‑account JSON on one line (see below)                         |
| `ALLOW_INSECURE_DEV_AUTH` | `true` only for local dev without a service account                           |

### Firebase service account (secure token verification)

1. Firebase Console → **Project Settings → Service Accounts → Generate new private key**.
2. Open the downloaded JSON, copy the whole thing onto **one line**, and paste it as
   the value of `FB_SERVICE_ACCOUNT` in `.env` (keep the `\n` inside `private_key`
   escaped — the server restores them).

No service account yet? For local dev only, set `ALLOW_INSECURE_DEV_AUTH=true`. The
server will then **decode** Firebase ID tokens without verifying their signature.
Never do this in production.

### Vercel deployment

Import this repository into Vercel. Vercel automatically uses `api/index.js` as the
serverless API entry point. Add these Production environment variables in the
Vercel project settings:

- `MONGODB_URI` (MongoDB Atlas; do not use localhost)
- `DB_NAME`
- `CORS_ORIGIN` (the deployed frontend URL)
- `FB_SERVICE_ACCOUNT` (the complete Firebase service-account JSON)
- `ALLOW_INSECURE_DEV_AUTH=false`

Do not upload `.env` or configure `ALLOW_INSECURE_DEV_AUTH=true` in production.

### MongoDB

Run a local `mongod`, or point `MONGODB_URI` at a MongoDB Atlas cluster. The server
creates the needed indexes on first connect.

**No MongoDB running?** For local dev only, if the configured `MONGODB_URI` is
unreachable the server automatically spins up an **in-memory MongoDB**
(`mongodb-memory-server`) so you can work without installing MongoDB. You'll see a
loud `⚠️  Starting an IN-MEMORY MongoDB` warning, and **data is not persisted** across
restarts. This fallback is disabled when `NODE_ENV=production` (there a bad
`MONGODB_URI` fails fast instead).

## API

All routes except `GET /` require a Firebase ID token:
`Authorization: Bearer <token>`.

| Method | Path                        | Auth    | Purpose                                                               |
| ------ | --------------------------- | ------- | --------------------------------------------------------------------- |
| GET    | `/`                         | –       | Health check                                                          |
| POST   | `/users`                    | token   | Create/update own user (`{name,email,role,photoURL,profileComplete}`) |
| GET    | `/users/:email/role`        | token   | Get a user's role                                                     |
| GET    | `/users/:email`             | token   | Get a user's profile                                                  |
| POST   | `/rooms`                    | teacher | Create an exam room                                                   |
| GET    | `/rooms`                    | token   | List rooms                                                            |
| GET    | `/rooms/:code`              | token   | Get one room                                                          |
| POST   | `/rooms/:code/join`         | token   | Student joins a room                                                  |
| POST   | `/exams/:roomId/violations` | token   | Log a proctoring violation                                            |
| GET    | `/exams/:roomId/violations` | teacher | List a room's violations                                              |

`role` is fixed at first insert — users cannot escalate their own role afterwards.

## Collections

- **users** `{ name, email, role, photoURL, profileComplete, createdAt, updatedAt }`
- **rooms** `{ code, title, type, teacherEmail, students[], questions[], createdAt }`
- **violations** `{ roomId, studentEmail, type, detail, ts }`
