import cors from "cors";
import express from "express";
import helmet from "helmet";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { env } from "./config/env";
import { pool } from "./config/db";
import { errorHandler } from "./middleware/errorHandler";
import healthRouter from "./routes/health";
import authRouter from "./routes/auth";
import jobsRouter from "./routes/jobs";
import applicationsRouter from "./routes/applications";
import candidatesRouter from "./routes/candidates";
import studentRouter from "./routes/student";
import recruiterRouter from "./routes/recruiter";
import uploadsRouter from "./routes/uploads";
import assessmentsRouter from "./routes/assessments";
import messagesRouter from "./routes/messages";
import notificationsRouter from "./routes/notifications";
import contactRouter from "./routes/contact";
import { closeWorkers, workers } from "./workers";
import { verifyAccessToken } from "./services/auth";
import { runSandboxed, validateCommand } from "./services/execution";
import { recordEvent } from "./services/monitoring";

const app = express();
// Render terminates TLS and proxies: without this, req.ip is the proxy's
// IP for every request and the per-IP rate limiters would treat all users
// as one bucket (5 logins/min shared globally). trust proxy 1 honours
// X-Forwarded-For from the immediate proxy only. Caveat: a client that
// can reach the server directly (not via Render) could spoof XFF to get a
// fresh rate-limit bucket — that only returns the limiter to its pre-fix
// state for that client; it cannot forge another user's identity, because
// auth is a signed JWT, never an IP.
app.set("trust proxy", 1);
app.use(helmet());
// Phase 8 (23 Nov 2026): CORS was wide open (Access-Control-Allow-Origin:
// * on every response, verified live). The API now only answers browsers
// from the configured client origin plus local dev origins. Requests with
// no Origin (curl, server-to-server, mobile apps) are unaffected — CORS is
// a browser mechanism. FRONTEND_URL must be set to the production client
// origin (https://groundtruth-ai-client.onrender.com) on Render; the
// default is the local dev client.
const allowedOrigins = Array.from(
  new Set([env.frontendUrl, "http://localhost:3000", "http://127.0.0.1:3000"]),
);
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) cb(null, true);
      else cb(null, false);
    },
  }),
);
app.use(express.json({ limit: "1mb" }));

app.use(healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/applications", applicationsRouter);
app.use("/api/candidates", candidatesRouter);
app.use("/api/student", studentRouter);
app.use("/api/recruiter", recruiterRouter);
app.use("/api/uploads", uploadsRouter);
app.use("/api/assessments", assessmentsRouter);
app.use("/api/messages", messagesRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/contact", contactRouter);

app.use(errorHandler);

const server = createServer(app);

// ── Live terminal WebSocket ────────────────────────────────────────────────
// WS /ws/execution/:sessionId/terminal?token=<jwt>
// Authenticated with the same JWT as the REST API. Commands run through the
// same sandboxed executor as the REST run endpoint (allowlisted, isolated,
// no network, resource-limited) and are recorded as terminal_command events.
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "", "http://localhost");
  const match = url.pathname.match(/^\/ws\/execution\/([0-9a-f-]+)\/terminal$/);
  if (!match) {
    socket.destroy();
    return;
  }
  const sessionId = match[1];
  const token = url.searchParams.get("token") ?? "";
  let user: { sub: string; role: string };
  try {
    user = verifyAccessToken(token);
  } catch {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    void (async () => {
      const session = await pool.query(
        `SELECT * FROM execution_sessions WHERE id = $1`,
        [sessionId],
      );
      if (!session.rows.length) {
        ws.close(4404, "Execution session not found");
        return;
      }
      const row = session.rows[0];
      const candidate = await pool.query(
        `SELECT id FROM candidates WHERE user_id = $1`,
        [user.sub],
      );
      if (
        !candidate.rows.length ||
        String(candidate.rows[0].id) !== String(row.candidate_id)
      ) {
        ws.close(4403, "Not your execution session");
        return;
      }
      ws.send(
        JSON.stringify({
          type: "ready",
          sessionId,
          assessmentId: row.assessment_id,
          sandboxBackend: row.sandbox_backend,
        }),
      );
      // Phase 8: one command at a time per connection. Without this, a
      // client could fire off N sandboxed commands at once and exhaust
      // the host (each runs a separate unshare sandbox + process).
      let commandRunning = false;
      ws.on("message", (raw) => {
        void (async () => {
          let msg: { type?: string; command?: unknown };
          try {
            msg = JSON.parse(String(raw)) as { type?: string; command?: unknown };
          } catch {
            ws.send(JSON.stringify({ type: "error", error: "Invalid JSON" }));
            return;
          }
          if (msg.type === "ping") {
            ws.send(JSON.stringify({ type: "pong" }));
            return;
          }
          if (msg.type !== "command" || !Array.isArray(msg.command)) {
            ws.send(JSON.stringify({ type: "error", error: "Send {type:'command', command:[...]}" }));
            return;
          }
          if (commandRunning) {
            ws.send(JSON.stringify({ type: "error", error: "A command is already running — wait for it to finish" }));
            return;
          }
          const command = msg.command.filter(
            (c): c is string => typeof c === "string",
          );
          try {
            validateCommand(command);
          } catch (err) {
            ws.send(
              JSON.stringify({ type: "error", error: (err as Error).message }),
            );
            return;
          }
          commandRunning = true;
          try {
            const result = await runSandboxed({
              workspaceDir: String(row.workspace_path),
              command,
            });
            await recordEvent({
              assessmentId: String(row.assessment_id),
              candidateId: String(row.candidate_id),
              sessionId,
              eventType: "terminal_command",
              metadata: {
                command: command.join(" "),
                exit_code: result.exitCode,
                duration_ms: result.durationMs,
                output_excerpt: (result.stdout + result.stderr).slice(0, 500),
              },
            }).catch(() => undefined);
            ws.send(
              JSON.stringify({
                type: "output",
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.exitCode,
                timedOut: result.timedOut,
                durationMs: result.durationMs,
              }),
            );
          } finally {
            commandRunning = false;
          }
        })();
      });
    })();
  });
});

server.listen(env.port, () => {
  console.log(`[server] listening on :${env.port} — workers running: ${workers.map((w) => w.name).join(", ")}`);
});

// Graceful shutdown: stop HTTP, then close workers and exit.
function shutdown(signal: string): void {
  console.log(`[server] ${signal} received — shutting down`);
  server.close(() => {
    void closeWorkers().finally(() => process.exit(0));
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
