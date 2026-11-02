// The custom request-logging middleware (Vision §3, CHQ-002 S6, S9, S10).
//
// It is this repository's own hook and not Fastify's built-in `pino`, which is a recorded
// decision rather than an oversight: §3 asks for "a custom request-logging middleware", so the
// framework's own logger answers a different question (CHQ-002, Contradictions).
//
// Three invariants THIS module enforces.
//   One entry per request, and exactly one: the hook is registered on `onResponse` alone, which
//   is the single point in the lifecycle where the status code and the elapsed time both exist
//   (`addHook('onResponse', …)` — docs/vendor/fastify.md).
//   One JSON object per line, written to a sink the caller supplies (spec Q1): stdout is the
//   default, and a test passes a collector instead of patching `process.stdout`.
//   The request BODY never appears in a line. Method, path, status and timing are operational
//   facts; the body is user data (S10). Nothing here reads `request.body`.

import type { FastifyInstance } from 'fastify';

/** The sink: one JSON object per LINE, newline-free — the writer adds the separator. */
export type LogSink = (line: string) => void;

/**
 * The entry's fields. §3's four are introduced by `e.g.` and are therefore a floor, so the
 * entry also carries `time` (usable once it reaches an aggregator), `level` (chosen from the
 * outcome) and `requestId` (so lines about one request join) — spec Q1, S6, S9.
 */
interface RequestLogEntry {
  readonly time: string;
  readonly level: string;
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly statusCode: number;
  readonly durationMs: number;
}

/** The default sink of Q1: one line to stdout, where the container and CloudWatch collect it. */
export const writeLineToStdout: LogSink = (line) => {
  process.stdout.write(`${line}\n`);
};

/** The level the outcome chose. A rejected request is logged like any other, louder (S6). */
function levelFor(statusCode: number): string {
  if (statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'warn';
  return 'info';
}

/**
 * Registers the hook on `app`. `now` is the clock as an argument, so a caller can pin the
 * `time` field; `request.id` is the correlation id Fastify minted for this request, which is
 * why every entry about one request carries the same one (S9).
 */
export function registerRequestLog(app: FastifyInstance, log: LogSink, now: () => Date): void {
  app.addHook('onResponse', (request, reply, done) => {
    const entry: RequestLogEntry = {
      time: now().toISOString(),
      level: levelFor(reply.statusCode),
      requestId: request.id,
      method: request.method,
      path: request.url,
      statusCode: reply.statusCode,
      durationMs: reply.elapsedTime,
    };
    log(JSON.stringify(entry));
    done();
  });
}
