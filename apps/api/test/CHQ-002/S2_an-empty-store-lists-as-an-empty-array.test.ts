// CHQ-002 S2 — GET /tasks on an empty store is 200 with `[]` exactly: an empty ARRAY, not
// `null`, not `{}`, not an envelope, and not an error.
// Spec: docs/specs/CHQ-002.md, body only. Written before any implementation exists; the
// single typed binding below is explained in S1's header.
import type { Task } from '@cheq/core';
import { describe, expect, it } from '@jest/globals';

import * as api from '../../src/index.ts';
import type { BuildApp } from './support/app.ts';

const buildApp: BuildApp = api.buildApp;

describe('CHQ-002 S2', () => {
  it('S2_lists_an_empty_store_as_200_and_an_empty_array', async () => {
    expect.hasAssertions();
    // No store is passed: S2's Given is an app whose store is empty, which is the adapter's
    // own store, fresh for this app.
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/tasks' });
    expect(res.statusCode).toBe(200);
    const body = res.json<readonly Task[]>();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toEqual([]);
    expect(body).toHaveLength(0);
  });

  it('S2_the_body_is_an_empty_array_and_not_an_envelope', async () => {
    expect.hasAssertions();
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/tasks' });
    // The raw payload is the sharpest form of the spec's "the body is `[]` exactly": it
    // falsifies `null`, `{}`, `{"tasks":[]}` and every other envelope in one assertion,
    // which a parsed-shape check does only one case at a time. `payload` is the raw body
    // string (docs/vendor/fastify.md).
    expect(res.payload).toBe('[]');
    // And an empty store is not a failure: nothing in the 4xx or 5xx range.
    expect(res.statusCode).toBeLessThan(400);
  });
});
