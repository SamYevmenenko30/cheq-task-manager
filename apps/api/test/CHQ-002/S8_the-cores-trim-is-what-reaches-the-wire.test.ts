// CHQ-002 S8 — posting `"  Write the README  "` returns the trimmed title in the 201 body and
// in the subsequent GET /tasks. The trim is the one CHQ-001's S6 fixed in the core; this
// package adds no second rule of its own.
// Spec: docs/specs/CHQ-002.md, body only. Written before any implementation exists; the
// single typed binding below is explained in S1's header.
import type { Task } from '@cheq/core';
import { describe, expect, it } from '@jest/globals';

import * as api from '../../src/index.ts';
import type { BuildApp } from './support/app.ts';

const buildApp: BuildApp = api.buildApp;

/** The padded title S8 quotes, and what the core's rule makes of it. */
const PADDED = '  Write the README  ';
const TRIMMED = 'Write the README';

describe('CHQ-002 S8', () => {
  it('S8_the_201_body_carries_the_trimmed_title', async () => {
    expect.hasAssertions();
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/tasks', payload: { title: PADDED } });
    expect(res.statusCode).toBe(201);
    expect(res.json<Task>().title).toBe(TRIMMED);
  });

  it('S8_the_listed_task_carries_the_trimmed_title', async () => {
    expect.hasAssertions();
    const app = await buildApp();
    const created = await app.inject({ method: 'POST', url: '/tasks', payload: { title: PADDED } });
    expect(created.statusCode).toBe(201);
    const body = (await app.inject({ method: 'GET', url: '/tasks' })).json<readonly Task[]>();
    expect(body.map((task) => task.title)).toEqual([TRIMMED]);
  });
});
