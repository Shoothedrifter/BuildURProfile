import { EventEmitter, setMaxListeners } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";
import { databaseOptions } from "../../../../packages/storage/src/database.mjs";

const channel = "buildurprofile_task_queue";
const queues = ["generations", "resume_parse_tasks"];
export const maxLeaseWaitMs = 20_000;

export function leaseWaitMs(value) {
  return Number.isInteger(value) && value > 0 ? Math.min(value, maxLeaseWaitMs) : 0;
}

export function createQueueNotifications(connectionString, schema) {
  const events = new EventEmitter();
  events.setMaxListeners(0);
  const shutdown = new AbortController();
  setMaxListeners(0, shutdown.signal);

  async function listen() {
    let retryMs = 1000;
    while (!shutdown.signal.aborted) {
      const client = new pg.Client(databaseOptions(connectionString, schema));
      let disconnect;
      const disconnected = new Promise(resolve => { disconnect = resolve; });
      client.on("error", disconnect);
      client.on("end", disconnect);
      client.on("notification", ({ channel: incoming, payload }) => {
        if (incoming === channel && payload?.startsWith(`${schema}:`)) {
          const queue = payload.slice(schema.length + 1);
          if (queues.includes(queue)) events.emit(queue);
        }
      });
      const stop = () => { disconnect(); void client.end().catch(() => {}); };
      shutdown.signal.addEventListener("abort", stop, { once: true });
      try {
        await client.connect();
        await client.query(`LISTEN ${channel}`);
        retryMs = 1000;
        for (const queue of queues) events.emit(queue);
        await disconnected;
      } catch {
        if (!shutdown.signal.aborted) console.warn("postgres task listener disconnected");
      } finally {
        shutdown.signal.removeEventListener("abort", stop);
        await client.end().catch(() => {});
      }
      if (!shutdown.signal.aborted) {
        await sleep(retryMs, undefined, { signal: shutdown.signal, ref: false }).catch(() => {});
        retryMs = Math.min(retryMs * 2, 15_000);
      }
    }
  }
  const listening = listen();

  async function claim(queue, waitMs, signal, take) {
    if (signal?.aborted || shutdown.signal.aborted) return null;
    if (!waitMs) return take();
    const deadline = performance.now() + waitMs;
    for (;;) {
      let wake;
      const awakened = new Promise(resolve => { wake = resolve; });
      const delay = Math.min(10_000, deadline - performance.now());
      if (delay <= 0) return null;
      const timer = setTimeout(wake, delay);
      events.once(queue, wake);
      signal?.addEventListener("abort", wake, { once: true });
      shutdown.signal.addEventListener("abort", wake, { once: true });
      try {
        if (signal?.aborted || shutdown.signal.aborted) return null;
        const task = await take();
        if (task) return task;
        await awakened;
        if (signal?.aborted || shutdown.signal.aborted) return null;
      } finally {
        clearTimeout(timer);
        events.off(queue, wake);
        signal?.removeEventListener("abort", wake);
        shutdown.signal.removeEventListener("abort", wake);
      }
    }
  }

  return { claim, async close() { shutdown.abort(); await listening; } };
}
