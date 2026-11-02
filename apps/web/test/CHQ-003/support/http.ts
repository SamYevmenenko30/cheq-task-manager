// The fetch double the CHQ-003 spec tests share.
//
// MEASURED 2026-11-02 in this project's `web` project (jest-environment-jsdom 30): neither
// `fetch` nor `Response` nor `Request` is defined in that environment — a test that built a
// real `Response` died with `ReferenceError: Response is not defined`, which red-check reads
// as a missing SYMBOL and would have scored as a red that is really a broken fixture. So
// nothing here mentions `Response` or `Request` at run time.
//
// `JsonResponse implements Response` rather than asserting its way to that type: a cast would
// be `typescript(no-unsafe-type-assertion)` (L-lint) and, worse, every member the double does
// not provide would read as `undefined` at run time. Implementing the interface makes the
// compiler list what is missing, and each missing member THROWS with its own name — so an
// implementation that reaches for `res.text()` is told that this double has no text, instead
// of seeing a silent `undefined`.
//
// The invariant THIS file carries: no case can observe a request that was not made through
// `globalThis.fetch`, because `seen()` is the only reader of what was called and it reads the
// mock's own call list.
import { expect, jest } from '@jest/globals';
import { cleanup, screen, waitFor } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import type { Task } from '@cheq/core';

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type FetchMock = jest.Mock<Fetch>;

/** What a handler is given: the request's path, and the init the caller passed. */
export type Handler = (path: string, init: RequestInit | undefined) => Promise<Response>;

/** The three members a caller may read; everything else the interface declares throws. */
class JsonResponse implements Response {
  readonly ok: boolean;
  readonly status: number;
  readonly #payload: unknown;

  constructor(payload: unknown, status: number) {
    this.#payload = payload;
    this.status = status;
    this.ok = status >= 200 && status < 300;
  }

  json(): Promise<unknown> {
    return Promise.resolve(this.#payload);
  }

  #absent(member: string): never {
    throw new Error(`the CHQ-003 fetch double provides ok, status and json() only — not ${member}`);
  }

  get headers(): Headers {
    return this.#absent('headers');
  }
  get redirected(): boolean {
    return this.#absent('redirected');
  }
  get statusText(): string {
    return this.#absent('statusText');
  }
  get type(): ResponseType {
    return this.#absent('type');
  }
  get url(): string {
    return this.#absent('url');
  }
  get body(): ReadableStream<Uint8Array<ArrayBuffer>> | null {
    return this.#absent('body');
  }
  get bodyUsed(): boolean {
    return this.#absent('bodyUsed');
  }
  clone(): Response {
    return this.#absent('clone()');
  }
  arrayBuffer(): Promise<ArrayBuffer> {
    return this.#absent('arrayBuffer()');
  }
  blob(): Promise<Blob> {
    return this.#absent('blob()');
  }
  bytes(): Promise<Uint8Array<ArrayBuffer>> {
    return this.#absent('bytes()');
  }
  formData(): Promise<FormData> {
    return this.#absent('formData()');
  }
  text(): Promise<string> {
    return this.#absent('text()');
  }
}

/** A response carrying `body` as its JSON. `status` defaults to the 200 of a read. */
export const json = (body: unknown, status = 200): Response => new JsonResponse(body, status);

/** A task with the three fields `@cheq/core` declares (contracts/CHQ-001/task.ts:15). */
export const task = (id: string, title: string): Task => ({
  id,
  title,
  createdAt: '2026-01-01T00:00:00.000Z',
});

/** A promise that never settles — the Given of "the request has not settled". */
export const pending = (): Promise<Response> => new Promise<Response>(() => {});

function rawUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** The pathname of whatever spelling the caller passed, relative or absolute. */
export function pathOf(input: string | URL | Request): string {
  return new URL(rawUrl(input), 'http://localhost').pathname;
}

function parseBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== 'string') return null;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

export interface SeenCall {
  readonly path: string;
  readonly method: string;
  readonly body: unknown;
}

/** Every request the double was given, decoded. The only reader of what was called. */
export function seen(mock: FetchMock): readonly SeenCall[] {
  return mock.mock.calls.map(([input, init]) => ({
    path: pathOf(input),
    method: (init?.method ?? 'GET').toUpperCase(),
    body: parseBody(init?.body),
  }));
}

export const callsTo = (mock: FetchMock, method: string, path: string): readonly SeenCall[] =>
  seen(mock).filter((c) => c.method === method && c.path === path);

/** Install the double and route every request through `handler`. */
export function installFetch(handler: Handler): FetchMock {
  const mock = jest.fn<Fetch>();
  mock.mockImplementation((input, init) => handler(pathOf(input), init));
  globalThis.fetch = mock;
  return mock;
}

/** Route `/tasks` and `/health` separately; any other path is a test's own mistake. */
export function routes(handlers: { tasks?: Handler; health?: Handler }): Handler {
  return (path, init) => {
    const h = path === '/tasks' ? handlers.tasks : path === '/health' ? handlers.health : undefined;
    if (h === undefined) return Promise.reject(new Error(`no handler for ${init?.method ?? 'GET'} ${path}`));
    return h(path, init);
  };
}

/**
 * Assert `el` is present and narrow it. The assertion comes FIRST so that a case whose Given
 * cannot be built yet fails on an `expect(` — the one signature red-check scores as
 * assertion-red (lib/junit-xml.mjs:382). A Testing Library `getBy*` would throw a
 * `TestingLibraryElementError` instead, which that reader cannot name and the gate must
 * therefore treat as CANNOT VERIFY.
 */
export function present(el: HTMLElement | null, what: string): HTMLElement {
  expect(el).not.toBeNull();
  if (el === null) throw new Error(`absent: ${what}`);
  return el;
}

export { cleanup };

/**
 * Wait until the list holds exactly `n` rows.
 *
 * `waitFor` and not `findByRole`: a `findBy*`/`getBy*` that finds nothing throws a
 * `TestingLibraryElementError`, which `redReason` cannot name and a gate must then treat as
 * CANNOT VERIFY. `waitFor` re-throws the LAST error its callback threw, so the failure that
 * reaches the artifact is the `expect(` inside it (measured 2026-11-02, both shapes).
 */
export const waitForRows = (n: number): Promise<void> =>
  waitFor(() => {
    expect(screen.queryAllByRole('listitem').length).toBe(n);
  });

/** The text of every row of the task list, in document order. */
export const rowTexts = (): readonly string[] =>
  screen.queryAllByRole('listitem').map((li) => li.textContent ?? '');

/** The health indicator: the live region whose accessible name names health. */
export const healthBadge = (): HTMLElement =>
  present(screen.queryByRole('status', { name: /health/i }), 'the health indicator (role="status", named /health/i)');

/** Put `title` in the form's title field and submit it. An empty title is not typed. */
export async function submitTitle(user: UserEvent, title: string): Promise<void> {
  const field = present(screen.queryByLabelText(/title/i), 'the form\'s title field, labelled /title/i');
  const button = present(screen.queryByRole('button', { name: /add|create/i }), 'the form\'s submit button, named /add|create/i');
  if (title.length > 0) await user.type(field, title);
  await user.click(button);
}
