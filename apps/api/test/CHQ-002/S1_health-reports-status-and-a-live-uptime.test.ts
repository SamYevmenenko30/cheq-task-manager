// CHQ-002 S1 — GET /health answers 200 with `status: "ok"` and a NUMERIC uptime that is the
// process's own and never a constant.
// Spec: docs/specs/CHQ-002.md, body only — its Appendix was not read. Written before any
// implementation exists.
import { describe, expect, it } from '@jest/globals';

import * as api from '../../src/index.ts';
import type { BuildApp } from './support/app.ts';

/**
 * The one thing CHQ-002 leaves missing, named ONCE per file.
 *
 * `BuildApp` (test-side, `support/app.ts`) says what the factory IS; this line says which
 * symbol must satisfy it. Two consequences, both wanted: every `inject` below is typechecked
 * against a real instance type rather than being an unchecked call on an error type, and the
 * file's whole "not written yet" sits on this line instead of at every call site. It is
 * reached through the NAMESPACE on purpose — a named import of an absent export is an ESM
 * link error, so the file would never load and the artifact would carry no row for any case
 * at all. The two lint findings it costs vanish with no edit to this file when `buildApp`
 * lands (tools/gates/lights/lint.mjs:118-141).
 */
const buildApp: BuildApp = api.buildApp;

describe('CHQ-002 S1', () => {
  it('S1_health_answers_200_with_status_ok_and_a_numeric_uptime', async () => {
    expect.hasAssertions();
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: unknown; uptime: unknown }>();
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
    expect(Number.isFinite(body.uptime)).toBe(true);
  });

  it('S1_uptime_does_not_decrease_between_two_injections', async () => {
    expect.hasAssertions();
    const app = await buildApp();
    const first = (await app.inject({ method: 'GET', url: '/health' })).json<{ uptime: unknown }>();

    // The "delay between" the two reads, spent on real work through the app's own surface.
    // A sleep is forbidden in a spec test and would measure the sleep rather than the
    // endpoint; two full round-trips are elapsed time the app actually spent.
    await app.inject({ method: 'GET', url: '/tasks' });
    await app.inject({ method: 'GET', url: '/tasks' });

    const second = (await app.inject({ method: 'GET', url: '/health' })).json<{ uptime: unknown }>();

    const before = first.uptime;
    const after = second.uptime;
    expect(typeof before).toBe('number');
    expect(typeof after).toBe('number');
    if (typeof before !== 'number' || typeof after !== 'number') {
      throw new Error('unreachable: the assertions above throw first');
    }
    expect(after).toBeGreaterThanOrEqual(before);
  });
});
