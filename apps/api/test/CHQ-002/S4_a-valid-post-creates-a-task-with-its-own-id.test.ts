// CHQ-002 S4 — POST /tasks with a valid title is 201 with that title, a non-empty `id` and a
// `createdAt` that parses as an instant; two such requests get two DIFFERENT ids. The id
// source is this package's, which is where CHQ-001's Q2 deferred the promise.
// Spec: docs/specs/CHQ-002.md, body only. Written before any implementation exists; the
// single typed binding below is explained in S1's header.
import type { Task } from '@cheq/core';
import { describe, expect, it } from '@jest/globals';

import * as api from '../../src/index.ts';
import type { BuildApp } from './support/app.ts';

const buildApp: BuildApp = api.buildApp;

/** S4's literal fixture, quoted from the assertion. */
const TITLE = 'Write the README';

describe('CHQ-002 S4', () => {
  it('S4_creates_a_task_with_201_and_the_posted_title', async () => {
    expect.hasAssertions();
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/tasks', payload: { title: TITLE } });
    expect(res.statusCode).toBe(201);
    expect(res.json<Task>().title).toBe(TITLE);
  });

  it('S4_the_created_task_carries_a_non_empty_id_and_a_createdAt_that_parses', async () => {
    expect.hasAssertions();
    const app = await buildApp();
    const body = (await app.inject({ method: 'POST', url: '/tasks', payload: { title: TITLE } })).json<Task>();
    expect(typeof body.id).toBe('string');
    expect(body.id).not.toBe('');
    expect(typeof body.createdAt).toBe('string');
    // "parses as an instant", and no more: the spec fixes no fractional-second form.
    expect(Number.isFinite(Date.parse(body.createdAt))).toBe(true);
  });

  it('S4_two_creations_get_different_ids', async () => {
    expect.hasAssertions();
    const app = await buildApp();
    const one = (await app.inject({ method: 'POST', url: '/tasks', payload: { title: TITLE } })).json<Task>();
    const other = (await app.inject({ method: 'POST', url: '/tasks', payload: { title: TITLE } })).json<Task>();
    // The SAME title on purpose: an id derived from the title would pass a distinctness check
    // made with two different titles and fail here.
    expect(other.id).not.toBe(one.id);
  });
});
