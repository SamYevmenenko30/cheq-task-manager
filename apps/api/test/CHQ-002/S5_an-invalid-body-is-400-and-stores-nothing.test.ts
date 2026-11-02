// CHQ-002 S5 — each of `{}`, `{"title":""}`, `{"title":"   "}` and `{"title":42}` is 400 with
// a message that names the reason, none is 201, and a GET /tasks afterwards is still `[]`.
// The rule being validated is the core's (`createTask`), not a second one here — the spec's
// Cross-package effects forbid restating it.
// Spec: docs/specs/CHQ-002.md, body only. Written before any implementation exists; the
// single typed binding below is explained in S1's header.
import type { Task } from '@cheq/core';
import { describe, expect, it } from '@jest/globals';
import type { LightMyRequestResponse } from 'fastify';

import * as api from '../../src/index.ts';
import type { BuildApp } from './support/app.ts';

const buildApp: BuildApp = api.buildApp;

/**
 * What every one of the four invalid bodies must produce. The `title` in the message is not a
 * string this file invented: the only reason in the system is the core's, and that rule names
 * the field it judges (`packages/core/src/tasks/title-rule.ts:12`). Since the adapter may not
 * restate the rule, the reason that reaches the wire is that one.
 */
function expectBadRequestNamingTheTitle(res: LightMyRequestResponse): void {
  expect(res.statusCode).toBe(400);
  expect(res.statusCode).not.toBe(201);
  const message = res.json<{ message: unknown }>().message;
  expect(typeof message).toBe('string');
  if (typeof message !== 'string') throw new Error('unreachable: the assertion above throws first');
  expect(message).not.toBe('');
  expect(message.toLowerCase()).toContain('title');
}

describe('CHQ-002 S5', () => {
  it('S5_rejects_a_body_with_no_title', async () => {
    expect.hasAssertions();
    const app = await buildApp();
    expectBadRequestNamingTheTitle(await app.inject({ method: 'POST', url: '/tasks', payload: {} }));
  });

  it('S5_rejects_an_empty_title', async () => {
    expect.hasAssertions();
    const app = await buildApp();
    expectBadRequestNamingTheTitle(await app.inject({ method: 'POST', url: '/tasks', payload: { title: '' } }));
  });

  it('S5_rejects_a_title_that_is_only_whitespace', async () => {
    expect.hasAssertions();
    const app = await buildApp();
    expectBadRequestNamingTheTitle(await app.inject({ method: 'POST', url: '/tasks', payload: { title: '   ' } }));
  });

  it('S5_rejects_a_title_that_is_not_a_string', async () => {
    expect.hasAssertions();
    const app = await buildApp();
    expectBadRequestNamingTheTitle(await app.inject({ method: 'POST', url: '/tasks', payload: { title: 42 } }));
  });

  it('S5_an_invalid_request_changes_nothing', async () => {
    expect.hasAssertions();
    const app = await buildApp();
    // All four at once: nothing here depends on their order, only on all of them being
    // refused, so this needs no sequential await (`eslint(no-await-in-loop)`).
    const refused = await Promise.all([
      app.inject({ method: 'POST', url: '/tasks', payload: {} }),
      app.inject({ method: 'POST', url: '/tasks', payload: { title: '' } }),
      app.inject({ method: 'POST', url: '/tasks', payload: { title: '   ' } }),
      app.inject({ method: 'POST', url: '/tasks', payload: { title: 42 } }),
    ]);
    for (const res of refused) {
      expect(res.statusCode).toBe(400);
    }
    const listed = await app.inject({ method: 'GET', url: '/tasks' });
    expect(listed.statusCode).toBe(200);
    expect(listed.json<readonly Task[]>()).toEqual([]);
  });
});
