import IORedis from "ioredis";
import { env } from "./env";

// One shared ioredis connection for BullMQ. BullMQ needs
// maxRetriesPerRequest: null on its connections.
export const redisConnection = new IORedis(env.redisUrl, {
  maxRetriesPerRequest: null,
});

export async function pingRedis(): Promise<boolean> {
  try {
    // ioredis queues commands and retries forever while disconnected, so a
    // bare ping() would hang /health when Redis is down. Race it against a
    // short timeout and report "unreachable" instead of hanging.
    const pong = await Promise.race([
      redisConnection.ping(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
    ]);
    return pong === "PONG";
  } catch (err) {
    console.error("[redis] ping failed", err);
    return false;
  }
}
