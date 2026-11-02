// The one place this app talks to the API, and the one place a JSON body stops being `unknown`.
//
// Two invariants THIS module enforces.
//
//   EVERY PATH IS RELATIVE. `/tasks` and `/health`, never an origin and never a build-time base
//   URL. CloudFront serves the SPA and the API from one origin (`infra/cdn.tf`), which is what
//   removes CORS and mixed content; an absolute URL baked at build time would couple this build
//   output to a Terraform output (spec CHQ-003, Cross-package effects). `vite.config.ts` carries
//   the matching `server.proxy` so the same two paths resolve in local development.
//
//   A RESPONSE BODY IS NARROWED, NEVER ASSERTED. `exactOptionalPropertyTypes` and
//   `noUncheckedIndexedAccess` are on and `res.json()` is `any`, so every reader below annotates
//   `unknown` and passes it through a type PREDICATE. A cast would make a server that changed
//   shape look like a client that renders `undefined`.

import type { Task } from '@cheq/core';

/** The two paths. Relative, for the reason in this file's header. */
export const TASKS_PATH = '/tasks';
export const HEALTH_PATH = '/health';

const JSON_HEADERS = { 'content-type': 'application/json' } as const;

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The three fields `@cheq/core` declares (contracts/CHQ-001/task.ts:15). */
function isTask(value: unknown): value is Task {
  return (
    isJsonObject(value) &&
    typeof value['id'] === 'string' &&
    typeof value['title'] === 'string' &&
    typeof value['createdAt'] === 'string'
  );
}

function isTaskList(value: unknown): value is readonly Task[] {
  return Array.isArray(value) && value.every(isTask);
}

/** The message a failed call carries, from the API's own envelope when it sent one. */
function messageIn(body: unknown): string | undefined {
  if (!isJsonObject(body)) return undefined;
  const message = body['message'];
  return typeof message === 'string' && message !== '' ? message : undefined;
}

/**
 * The body of a response this app did not expect.
 *
 * `json()` and nothing else: the API answers JSON on every route and on its 400, and reading
 * `text()` as a fallback would be a second decoding path that only the error case exercises.
 */
async function failureOf(res: Response, what: string): Promise<Error> {
  const body: unknown = await res.json().catch(() => null);
  return new Error(messageIn(body) ?? `${what} answered ${String(res.status)}`);
}

/** Every task the API holds, in the order it listed them (S1). */
export async function fetchTasks(): Promise<readonly Task[]> {
  const res = await fetch(TASKS_PATH);
  if (!res.ok) throw await failureOf(res, 'GET /tasks');

  const body: unknown = await res.json();
  if (!isTaskList(body)) throw new Error('GET /tasks answered something that is not a list of tasks');
  return body;
}

/**
 * The created task, as the `201` body carried it (S6).
 *
 * `title` is already the rule's verdict when it arrives here — `acceptTitle` ran in the form, so
 * what goes on the wire is the trimmed title and nothing else is in the body (S5).
 */
export async function createTask(title: string): Promise<Task> {
  const res = await fetch(TASKS_PATH, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw await failureOf(res, 'POST /tasks');

  const body: unknown = await res.json();
  if (!isTask(body)) throw new Error('POST /tasks answered something that is not a task');
  return body;
}

/**
 * Whether the API reported itself healthy — `{ status: 'ok' }` and nothing else (S8, S9).
 *
 * A non-2xx answer and a 200 whose `status` is not `ok` are the SAME verdict here, which is what
 * S9 asserts: an indicator that trusted any 200 would show green for a degraded API.
 */
export async function fetchHealth(): Promise<boolean> {
  const res = await fetch(HEALTH_PATH);
  if (!res.ok) return false;

  const body: unknown = await res.json();
  return isJsonObject(body) && body['status'] === 'ok';
}
