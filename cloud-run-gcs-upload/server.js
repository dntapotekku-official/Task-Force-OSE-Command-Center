import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import { Storage } from "@google-cloud/storage";

const PORT = process.env.PORT || 8080;
const BUCKET_NAME = process.env.BUCKET_NAME || "task-force";
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "task-force-ose-command-center";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "https://task-force-ose-command-center.apotekku.com")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `https://storage.googleapis.com/${BUCKET_NAME}`).replace(/\/+$/, "");
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024);

admin.initializeApp({ projectId: FIREBASE_PROJECT_ID });

const storage = new Storage();
const bucket = storage.bucket(BUCKET_NAME);
const app = express();

app.use(express.json({ limit: "64kb" }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error("Origin tidak diizinkan."));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 3600
}));

function publicObjectUrl(path) {
  return `${PUBLIC_BASE_URL}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function assertUploadRequest(body) {
  const path = String(body.path || "");
  const contentType = String(body.contentType || "");
  const size = Number(body.size || 0);

  if (!/^uploads\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9][a-z0-9._-]*\.(jpg|jpeg|png|webp)$/i.test(path)) {
    const err = new Error("Path upload tidak valid.");
    err.status = 400;
    throw err;
  }
  if (!/^image\/(jpeg|png|webp)$/.test(contentType)) {
    const err = new Error("Tipe file harus jpg, png, atau webp.");
    err.status = 400;
    throw err;
  }
  if (!Number.isFinite(size) || size <= 0 || size > MAX_UPLOAD_BYTES) {
    const err = new Error("Ukuran file melebihi batas.");
    err.status = 400;
    throw err;
  }
  return { path, contentType, size };
}

async function verifyFirebaseUser(req) {
  const header = req.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    const err = new Error("Token Firebase tidak ditemukan.");
    err.status = 401;
    throw err;
  }
  return admin.auth().verifyIdToken(match[1]);
}

app.get("/healthz", (req, res) => {
  res.json({ ok: true });
});

app.post("/sign-upload", async (req, res, next) => {
  try {
    const user = await verifyFirebaseUser(req);
    const { path, contentType } = assertUploadRequest(req.body || {});
    const file = bucket.file(path);
    const [uploadUrl] = await file.getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + 15 * 60 * 1000,
      contentType,
      extensionHeaders: {
        "x-goog-meta-firebase-uid": user.uid
      }
    });

    res.json({
      uploadUrl,
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "x-goog-meta-firebase-uid": user.uid
      },
      path,
      publicUrl: publicObjectUrl(path),
      expiresInSeconds: 900
    });
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || "Upload signer gagal." });
});

app.listen(PORT, () => {
  console.log(`GCS upload signer listening on ${PORT}`);
});
