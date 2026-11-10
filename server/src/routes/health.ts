import { Router } from "express";
import { pingDb } from "../config/db";
import { pingRedis } from "../config/queue";
import { asyncHandler } from "../middleware/errorHandler";

const router = Router();

export interface HealthStatus {
  status: "ok" | "degraded";
  service: string;
  dependencies: { postgres: string; redis: string };
  uptimeSeconds: number;
}

// GET /health — per-dependency status so ops can see exactly what is down.
router.get(
  "/health",
  asyncHandler(async (_req, res) => {
    const [dbOk, redisOk] = await Promise.all([pingDb(), pingRedis()]);
    const status: HealthStatus = {
      status: dbOk && redisOk ? "ok" : "degraded",
      service: "groundtruth-server",
      dependencies: {
        postgres: dbOk ? "ok" : "unreachable",
        redis: redisOk ? "ok" : "unreachable",
      },
      uptimeSeconds: Math.round(process.uptime()),
    };
    res.status(status.status === "ok" ? 200 : 503).json(status);
  }),
);

export default router;
