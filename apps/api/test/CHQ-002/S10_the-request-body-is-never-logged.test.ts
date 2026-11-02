// CHQ-002 S10 — no log entry produced by a POST /tasks contains the posted title anywhere in
// it. The method, the path, the status and the timing are logged; the request BODY is user
// data and is not (spec, Q1).
// Spec: docs/specs/CHQ-002.md, body only. Written before any implementation exists; the
// single typed binding below is explained in S1's header.
import { describe, expect, it } from '@jest/globals';

import * as api from '../../src/index.ts';
import type { BuildApp } from './support/app.ts';
import { collectingLog, entriesOf, onlyEntry } from './support/app.ts';

const buildApp: BuildApp = api.buildApp;

/** The title S10 quotes. It is distinctive so a substring search over a whole line is exact. */
const SECRET = 'a-secret-looking-title';

describe('CHQ-002 S10', () => {
  it('S10_no_log_entry_contains_the_posted_title', async () => {
    expect.hasAssertions();
    const collected = collectingLog();
    const app = await buildApp({ log: collected.log });
    const res = await app.inject({ method: 'POST', url: '/tasks', payload: { title: SECRET } });
    expect(res.statusCode).toBe(201);
    // The RAW lines, not the parsed fields: "anywhere in it" includes a field nobody named
    // and a body echoed into a message.
    expect(collected.lines.length).toBeGreaterThan(0);
    for (const line of collected.lines) {
      expect(line).not.toContain(SECRET);
    }
  });

  it('S10_the_entry_still_carries_the_method_the_path_the_status_and_the_timing', async () => {
    expect.hasAssertions();
    const collected = collectingLog();
    const app = await buildApp({ log: collected.log });
    await app.inject({ method: 'POST', url: '/tasks', payload: { title: SECRET } });
    expect(collected.lines).toHaveLength(1);
    // The other half of S10: withholding the body is not withholding the line. A middleware
    // that logged nothing at all would satisfy the first case and fail this one.
    const entry = onlyEntry(entriesOf(collected.lines));
    expect(entry['method']).toBe('POST');
    expect(entry['path']).toBe('/tasks');
    expect(entry['statusCode']).toBe(201);
    expect(typeof entry['durationMs']).toBe('number');
  });
});
