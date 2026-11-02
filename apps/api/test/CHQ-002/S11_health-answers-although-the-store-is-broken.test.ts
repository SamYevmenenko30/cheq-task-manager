// CHQ-002 S11 — with a store whose `list` and `add` both REJECT, GET /health is still 200
// with `status: "ok"`. Health does not touch the business path: a load balancer routes on it,
// and a health check that fails with the store takes a live instance out of rotation for a
// reason it cannot fix (spec, Q2).
// Spec: docs/specs/CHQ-002.md, body only. Written before any implementation exists; the
// single typed binding below is explained in S1's header.
import { describe, expect, it } from '@jest/globals';

import * as api from '../../src/index.ts';
import type { BuildApp } from './support/app.ts';
import { rejectingStore } from './support/app.ts';

const buildApp: BuildApp = api.buildApp;

describe('CHQ-002 S11', () => {
  it('S11_health_answers_200_although_the_store_rejects', async () => {
    expect.hasAssertions();
    const app = await buildApp({ store: rejectingStore() });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: unknown }>().status).toBe('ok');
  });

  it('S11_the_same_store_does_break_the_task_route', async () => {
    expect.hasAssertions();
    // The guard against a vacuous S11: if the broken store were never reached by anything,
    // the assertion above would hold for an app that ignores the `store` argument entirely.
    // What the task route answers instead is not asserted — the spec fixes no status for a
    // broken store, and inventing one here would be a rule nobody wrote.
    const app = await buildApp({ store: rejectingStore() });
    const res = await app.inject({ method: 'GET', url: '/tasks' });
    expect(res.statusCode).not.toBe(200);
  });
});
