import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env";
import { errorHandler } from "./middleware/errorHandler";
import healthRouter from "./routes/health";
import jobsRouter from "./routes/jobs";
import candidatesRouter from "./routes/candidates";
import uploadsRouter from "./routes/uploads";
import { closeWorkers, workers } from "./workers";

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use(healthRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/candidates", candidatesRouter);
app.use("/api/uploads", uploadsRouter);

app.use(errorHandler);

const server = app.listen(env.port, () => {
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
