// CHQ-002 S6 — one request produces EXACTLY ONE entry; it parses as JSON and carries `time`,
// `level`, `method`, `path`, `statusCode` and a numeric `durationMs`; and a request that 400s
// is logged like any other, with its own status.
// The sink is an ARGUMENT of the factory (spec, Q1): a test passes a collector and asserts
// over an array, because a test that patched `process.stdout` would assert on the patch.
// Spec: docs/specs/CHQ-002.md, body only. Written before any implementation exists; the
// single typed binding below is explained in S1's header.
import { describe, expect, it } from '@jest/globals';

import * as api from '../../src/index.ts';
import type { BuildApp } from './support/app.ts';
import { collectingLog, entriesOf, isIsoInstant, onlyEntry } from './support/app.ts';

const buildApp: BuildApp = api.buildApp;

describe('CHQ-002 S6', () => {
  it('S6_one_request_produces_exactly_one_entry', async () => {
    expect.hasAssertions();
    const collected = collectingLog();
    const app = await buildApp({ log: collected.log });
    await app.inject({ method: 'GET', url: '/tasks' });
    // EXACTLY ONE, which is stronger than "a line": a middleware registered on two hooks
    // satisfies the requirement's sentence and is wrong (spec, AC map §15).
    expect(collected.lines).toHaveLength(1);
  });

  it('S6_the_entry_carries_the_fields_the_spec_names', async () => {
    expect.hasAssertions();
    const collected = collectingLog();
    const app = await buildApp({ log: collected.log });
    await app.inject({ method: 'GET', url: '/tasks' });
    expect(collected.lines).toHaveLength(1);
    const entry = onlyEntry(entriesOf(collected.lines));
    expect(isIsoInstant(entry['time'])).toBe(true);
    expect(typeof entry['level']).toBe('string');
    expect(entry['level']).not.toBe('');
    expect(entry['method']).toBe('GET');
    expect(entry['path']).toBe('/tasks');
    expect(entry['statusCode']).toBe(200);
    expect(typeof entry['durationMs']).toBe('number');
    expect(Number.isFinite(entry['durationMs'])).toBe(true);
  });

  it('S6_a_rejected_request_is_logged_with_its_400', async () => {
    expect.hasAssertions();
    const collected = collectingLog();
    const app = await buildApp({ log: collected.log });
    const res = await app.inject({ method: 'POST', url: '/tasks', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(collected.lines).toHaveLength(1);
    const entry = onlyEntry(entriesOf(collected.lines));
    expect(entry['statusCode']).toBe(400);
    expect(entry['method']).toBe('POST');
    expect(entry['path']).toBe('/tasks');
  });
});
