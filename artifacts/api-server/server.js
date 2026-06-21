"use strict";

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { Pool } = require("pg");

// ---------------------------------------------------------------------------
// Database — Replit native PostgreSQL via DATABASE_URL
// ---------------------------------------------------------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: true }
      : false,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  console.error("[db] idle client error", err.message);
});

// Attach pool to every request so controllers can do req.db.query(...)
function attachDb(req, _res, next) {
  req.db = pool;
  next();
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      return callback(null, true);
    },
    credentials: true,
  }),
);
// Raw-body capture for Lemon Squeezy webhook HMAC verification.
// Must be mounted BEFORE express.json() so the raw bytes are available.
app.use(
  "/api/webhooks/lemonsqueezy",
  express.raw({ type: "application/json" }),
  (req, _res, next) => {
    req.rawBody = req.body;
    next();
  },
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(attachDb);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get("/api/healthz", async (req, res) => {
  try {
    await req.db.query("SELECT 1");
    res.json({ status: "ok", db: "connected", ts: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: "error", db: "unreachable" });
  }
});

const tenantRouter = require("./src/controllers/tenant.controller");
app.use("/api/tenants", tenantRouter);

// ---------------------------------------------------------------------------
// 404 handler
// ---------------------------------------------------------------------------
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ---------------------------------------------------------------------------
// Global error middleware  (must be last, 4-arg signature required by Express)
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal server error";

  if (status >= 500) {
    console.error("[error]", err);
  }

  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] Atelier OmniCore API listening on :${PORT}`);
});

module.exports = { app, pool };
