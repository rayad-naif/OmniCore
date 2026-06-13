import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { createServer, type Server as HttpServer } from "node:http";
import router, { emailWebhook } from "./routes";
import { logger } from "./lib/logger";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { attachSocketServer } = require("./services/socket.service");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pool } = require("./lib/db");

// Injects the shared pg.Pool as req.db — consumed by CJS controllers via req.db.query()
function attachDb(
  req: express.Request,
  _res: express.Response,
  next: express.NextFunction,
): void {
  (req as express.Request & { db: unknown }).db = pool;
  next();
}

const app: Express = express();

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet());

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim())
  : "*";

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);

// ── Structured request logging ────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// ── Raw-body capture for Lemon Squeezy HMAC verification ─────────────────────
// Must be mounted BEFORE express.json() so req.rawBody contains the raw bytes.
app.use(
  "/api/webhooks/lemonsqueezy",
  express.raw({ type: "application/json" }),
  (req, _res, next) => {
    (req as express.Request & { rawBody: Buffer }).rawBody = req.body as Buffer;
    next();
  },
);

// ── Body parsers ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ── Cookie parser (for httpOnly refresh token) ────────────────────────────────
app.use(cookieParser());

// ── Database pool injection (req.db) ──────────────────────────────────────────
app.use(attachDb);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api", router);

// ── Global error handler (4-arg signature required by Express) ────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error & { status?: number; statusCode?: number }, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status  = (err as { status?: number }).status ?? (err as { statusCode?: number }).statusCode ?? 500;
  const message = err.message || "Internal server error";

  if (status >= 500) {
    req.log?.error({ err }, "unhandled_error");
  }

  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
});

// ── HTTP server + Socket.io factory ──────────────────────────────────────────
export function createAppServer(): HttpServer {
  const httpServer = createServer(app);

  // socket.service.js creates the Socket.io server internally and returns it.
  // Passing it to emailWebhook.setIo() lets inbound-mail events flow in real time.
  const io = attachSocketServer(httpServer) as { to: unknown };
  emailWebhook.setIo(io);

  return httpServer;
}

export default app;
