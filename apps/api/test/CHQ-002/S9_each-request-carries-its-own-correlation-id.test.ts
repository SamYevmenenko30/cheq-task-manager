// CHQ-002 S9 — each log entry carries a `requestId`, two requests get two different ones, and
// every entry about a single request carries the same one, so lines about one request can be
// joined and a client can name the request an error came from.
// Spec: docs/specs/CHQ-002.md, body only. Written before any implementation exists; the
// single typed binding below is explained in S1's header.
import { describe, expect, it } from '@jest/globals';

import * as api from '../../src/index.ts';
import type { BuildApp } from './support/app.ts';
import { collectingLog, entriesOf } from './support/app.ts';

const buildApp: BuildApp = api.buildApp;

describe('CHQ-002 S9', () => {
  it('S9_two_requests_get_two_different_request_ids', async () => {
    expect.hasAssertions();
    const collected = collectingLog();
    const app = await buildApp({ log: collected.log });
    await app.inject({ method: 'GET', url: '/tasks' });
    await app.inject({ method: 'GET', url: '/health' });
    const ids = entriesOf(collected.lines).map((entry) => entry['requestId']);
    expect(ids).toHaveLength(2);
    for (const id of ids) {
      expect(typeof id).toBe('string');
      expect(id).not.toBe('');
    }
    expect(new Set(ids).size).toBe(2);
  });

  it('S9_every_entry_about_one_request_carries_the_same_id', async () => {
    expect.hasAssertions();
    const collected = collectingLog();
    const app = await buildApp({ log: collected.log });

    // The collector is read BETWEEN the two injections, so the lines are partitioned by the
    // request that produced them without the test needing to know how many each produces.
    await app.inject({ method: 'GET', url: '/tasks' });
    const ofFirst = entriesOf(collected.lines);
    await app.inject({ method: 'GET', url: '/health' });
    const ofSecond = entriesOf(collected.lines).slice(ofFirst.length);

    for (const group of [ofFirst, ofSecond]) {
      expect(group.length).toBeGreaterThan(0);
      const ids = new Set(group.map((entry) => entry['requestId']));
      expect(ids.size).toBe(1);
    }
  });
});
