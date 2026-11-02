// Test-side support for CHQ-002. Spec: docs/specs/CHQ-002.md, body only — its Appendix was
// not read. Written before any implementation exists.
//
// Why these declarations are HERE and not in a contract. The spec's front matter says
// `contracts: forbidden`: apps/api is an adapter and declares no shape of its own, and the
// task shape it transports is `@cheq/core`'s, imported below rather than restated. What this
// file declares is not a shape of the adapter — it is the SIGNATURE of the thing under test
// plus the collectors the assertions read, which is a test's own business. That buys two
// things the eleven case files need: every call is typechecked against a type instead of
// being an unchecked call on an error type, and each file's whole "not written yet" sits on
// one binding line. red-check stages this file onto the base with every case file
// (`red-check.mjs:406`), so a file judged alone still has it.
//
// The invariant THIS file carries: it names what the tests call and nothing about how it
// works. No value here is a fixture of the domain, and nothing here touches a clock.

import type { TaskStore } from '@cheq/core';
import type { FastifyInstance } from 'fastify';

/**
 * The sink Q1 decided: the factory takes it as an ARGUMENT defaulting to stdout, and what it
 * receives is one JSON object per LINE. So the parameter is a string a test parses (S6) and
 * never a structured record — and a test that patched `process.stdout` would be asserting on
 * the patch rather than on the middleware, which is the second half of that answer.
 */
export type LogSink = (line: string) => void;

/**
 * What the factory is handed. Both fields are optional and each is forced by an assertion:
 * `log` by S6, S9 and S10, which need a collecting sink; `store` by S11, which needs a store
 * whose methods reject. `store` ABSENT is S2's "an app whose store is empty" — the adapter's
 * own, fresh per app — so the tests that are not about a broken store pass no store at all.
 */
export interface BuildAppOptions {
  readonly log?: LogSink;
  readonly store?: TaskStore;
}

/**
 * The app factory (every S but S7).
 *
 * The return type is a union rather than `FastifyInstance` alone because the spec fixes that
 * a factory exists and what it is given, and says nothing about whether it is synchronous.
 * Every case `await`s the result, so either implementation satisfies these tests and neither
 * is asserted. `inject` needs no `listen()` and no `ready()` — it boots the instance itself
 * (docs/vendor/fastify.md, measured 2026-11-01).
 */
export type BuildApp = (options?: BuildAppOptions) => FastifyInstance | Promise<FastifyInstance>;

/** The in-memory store adapter S7 judges on its own, away from any route. */
export type CreateInMemoryTaskStore = () => TaskStore;

/** A sink that keeps what it was handed, plus the lines it has collected so far. */
export interface CollectingLog {
  readonly lines: readonly string[];
  readonly log: LogSink;
}

/** S6's Given: the collector the factory is handed instead of stdout. */
export function collectingLog(): CollectingLog {
  const lines: string[] = [];
  return {
    lines,
    log: (line: string) => {
      lines.push(line);
    },
  };
}

/**
 * S11's Given: a store whose BOTH methods reject. Not a store that throws synchronously —
 * the port is `Promise`-returning (`@cheq/core`'s `TaskStore`), and a rejection is the
 * failure a real driver produces. Neither method names its parameter: a function of lower
 * arity satisfies the port, and an unused binding would be noise.
 */
export function rejectingStore(): TaskStore {
  return {
    add: () => Promise.reject(new Error('the store is unavailable')),
    list: () => Promise.reject(new Error('the store is unavailable')),
  };
}

/**
 * A JSON object, narrowed by a type PREDICATE rather than by an `as`: a cast would be the
 * one construct that could make every assertion below it about a value nobody checked, and
 * `typescript/no-unsafe-type-assertion` refuses it.
 */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The collected lines as JSON objects.
 *
 * It THROWS on a line that is not a JSON object, which is deliberate: S6 asserts that an
 * entry "parses as JSON", so a line that does not is a failure of the assertion and must
 * surface as one rather than as a silently skipped row. The fields are read back as
 * `unknown` because an entry is unvalidated data — every assertion over them narrows for
 * itself.
 */
export function entriesOf(lines: readonly string[]): readonly Record<string, unknown>[] {
  return lines.map((line) => {
    const parsed: unknown = JSON.parse(line);
    if (!isJsonObject(parsed)) throw new Error(`a log line is not a JSON object: ${line}`);
    return parsed;
  });
}

/**
 * Is this string an ISO-8601 instant (S6's `time`)? It asks for a date-shaped prefix AND a
 * value the platform can parse, and deliberately does NOT pin the millisecond form: the spec
 * says "an ISO-8601 instant" and nothing about the number of fractional digits, so pinning
 * one would assert something nobody wrote. `Date.parse` takes its argument, so this reads no
 * clock.
 */
export function isIsoInstant(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

/**
 * The one entry a single request produced, after the caller has asserted the count with an
 * `expect`. It throws rather than returning `undefined`, so a mis-assertion surfaces here
 * instead of turning into a comparison against `undefined` that could accidentally hold.
 */
export function onlyEntry(entries: readonly Record<string, unknown>[]): Record<string, unknown> {
  const [first] = entries;
  if (entries.length !== 1 || first === undefined) {
    throw new Error(`expected exactly one log entry, got ${String(entries.length)}`);
  }
  return first;
}
