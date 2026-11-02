// CHQ-002 S3 — three tasks created through POST /tasks come back from GET /tasks in the order
// they were created, each carrying `id`, `title` and `createdAt`. Insertion order is this
// package's promise: CHQ-001 declined to make it from the core (that spec's Q3).
// Spec: docs/specs/CHQ-002.md, body only. Written before any implementation exists; the
// single typed binding below is explained in S1's header.
import type { Task } from '@cheq/core';
import { describe, expect, it } from '@jest/globals';

import * as api from '../../src/index.ts';
import type { BuildApp } from './support/app.ts';

const buildApp: BuildApp = api.buildApp;

/** S3's known order. Three titles that are distinguishable in any permutation. */
const FIRST = 'first task';
const SECOND = 'second task';
const THIRD = 'third task';
const TITLES = [FIRST, SECOND, THIRD];

type App = Awaited<ReturnType<BuildApp>>;

/**
 * S3's Given: three tasks created in THIS order.
 *
 * The three POSTs are unrolled rather than looped, and that is forced from both sides: the
 * order under test rules out `Promise.all`, and `eslint(no-await-in-loop)` rules out the
 * sequential loop. The 201 is asserted on each because a Given that silently failed would
 * make every assertion below vacuously true against an empty list.
 */
async function appWithTheThreeTasks(): Promise<App> {
  const app = await buildApp();
  expect((await app.inject({ method: 'POST', url: '/tasks', payload: { title: FIRST } })).statusCode).toBe(201);
  expect((await app.inject({ method: 'POST', url: '/tasks', payload: { title: SECOND } })).statusCode).toBe(201);
  expect((await app.inject({ method: 'POST', url: '/tasks', payload: { title: THIRD } })).statusCode).toBe(201);
  return app;
}

describe('CHQ-002 S3', () => {
  it('S3_lists_the_three_created_tasks_in_creation_order', async () => {
    expect.hasAssertions();
    const app = await appWithTheThreeTasks();
    const res = await app.inject({ method: 'GET', url: '/tasks' });
    expect(res.statusCode).toBe(200);
    const body = res.json<readonly Task[]>();
    expect(body).toHaveLength(3);
    expect(body.map((task) => task.title)).toEqual(TITLES);
  });

  it('S3_each_listed_task_carries_an_id_a_title_and_a_createdAt', async () => {
    expect.hasAssertions();
    const app = await appWithTheThreeTasks();
    const body = (await app.inject({ method: 'GET', url: '/tasks' })).json<readonly Task[]>();
    expect(body).toHaveLength(3);
    for (const task of body) {
      expect(typeof task.id).toBe('string');
      expect(task.id).not.toBe('');
      expect(typeof task.title).toBe('string');
      expect(task.title).not.toBe('');
      expect(typeof task.createdAt).toBe('string');
      expect(Number.isFinite(Date.parse(task.createdAt))).toBe(true);
    }
  });
});
