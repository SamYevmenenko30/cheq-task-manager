// The entry point of @cheq/api: the Fastify adapter. Its routes arrive through specs
// (docs/specs/CHQ-<nnn>.md) — CHQ-002 is the first, and brings the three endpoints, the
// request-logging middleware and the in-memory store adapter.
//
// The invariant THIS app enforces: no rule lives here. A decision that belongs to the product
// is taken in @cheq/core and only transported by this layer.

export const API_PACKAGE = '@cheq/api' as const;

export type { BuildAppOptions } from './app.ts';
export { buildApp } from './app.ts';
export { createInMemoryTaskStore } from './in-memory-task-store.ts';
export type { LogSink } from './request-log.ts';
export { writeLineToStdout } from './request-log.ts';
