// The app factory: the three endpoints of CHQ-002, mapped onto `@cheq/core` calls and back.
//
// Three invariants THIS module enforces.
//   No rule lives here. The title rule, its trim and its single failure are the core's
//   (`createTask`), so the 400 of S5 and the trimmed title of S8 are that one rule reaching the
//   wire — a regex in a handler would be a second rule that can disagree with the first and
//   nothing would notice until they did (spec, Cross-package effects).
//   Everything the core may not do enters through this factory's arguments and nowhere else:
//   the store, the id source and the clock. That is the one seam where this process's
//   nondeterminism lives, and it is why S4's "two different ids" is assertable without luck.
//   `/health` touches no store (spec Q2, S11): a load balancer routes on it, and a health check
//   that failed with the business path would take a live instance out of rotation for a reason
//   it cannot fix.

import type { Task, TaskStore } from '@cheq/core';
import { createTask, listTasks } from '@cheq/core';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

import { createInMemoryTaskStore } from './in-memory-task-store.ts';
import type { LogSink } from './request-log.ts';
import { registerRequestLog, writeLineToStdout } from './request-log.ts';

/**
 * What the factory is handed. Every field is optional and every default is this package's own
 * answer to something the core may not supply: the store (an in-memory adapter, fresh per app),
 * the log sink (stdout, per spec Q1), the id source and the clock.
 */
export interface BuildAppOptions {
  readonly log?: LogSink;
  readonly store?: TaskStore;
  readonly newId?: () => string;
  readonly now?: () => Date;
}

/** A JSON object, narrowed by a type PREDICATE rather than by an assertion. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The `title` of the request body as it arrives — `unknown`, because it has crossed a JSON
 * boundary and the rule that judges it takes `unknown` for exactly that reason. A body that is
 * not an object at all has no title, which the core then refuses like any other non-string.
 */
function titleOf(body: unknown): unknown {
  return isJsonObject(body) ? body['title'] : undefined;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const log = options.log ?? writeLineToStdout;
  const store = options.store ?? createInMemoryTaskStore();
  const newId = options.newId ?? ((): string => randomUUID());
  const now = options.now ?? ((): Date => new Date());

  // `logger: false` because the middleware below is the only logger (Vision §3): Fastify's own
  // `pino` would put a second, differently shaped line on the same stream.
  // `genReqId` is the correlation id of S9. It is deliberately not `newId`: a caller that pins
  // the task id for a predictable fixture must not thereby collapse two requests onto one id.
  const app = Fastify({ logger: false, genReqId: (): string => randomUUID() });

  registerRequestLog(app, log, now);

  // S1, S11: the process's own uptime, and nothing else is read.
  app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  // S2, S3: whatever the port resolved with, in the order it resolved with.
  app.get('/tasks', async (): Promise<readonly Task[]> => listTasks(store));

  // S4, S5, S8: the core decides; this handler only chooses the status and the envelope.
  app.post('/tasks', async (request, reply) => {
    const outcome = await createTask(store, {
      title: titleOf(request.body),
      id: newId(),
      now: now(),
    });

    if (outcome.status === 'invalid-title') {
      // The message is the core's reason verbatim — the only reason in the system (S5).
      return reply.code(400).send({ message: outcome.reason });
    }
    return reply.code(201).send(outcome.task);
  });

  return app;
}
