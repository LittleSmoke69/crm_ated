import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';

const QUEUE_NAME = 'webhook-evolution';
const REDIS_URL = process.env.REDIS_QUEUE_URL ?? 'redis://:redis123@redis_shared:6379';

function parseRedisUrl(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port) || 6379,
    password: u.password || undefined,
    db: Number(u.pathname.replace('/', '') || 0),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

export function createRedisConnection() {
  return new IORedis(parseRedisUrl(REDIS_URL));
}

export function getWebhookQueue() {
  const connection = createRedisConnection();
  return new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'fixed', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  });
}

export type WebhookJobData = {
  payload: any;
  zaplotoId: string | null;
};

let queueInstance: Queue | null = null;

export function getSharedWebhookQueue(): Queue {
  if (!queueInstance) {
    queueInstance = getWebhookQueue();
  }
  return queueInstance;
}
