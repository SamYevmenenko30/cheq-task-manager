// CHQ-003 S9 — a rejected `/health`, and any status that is not `ok`, read as unhealthy.
//
// Both halves of the assertion's "or" get a case, because they fail independently: a tree
// that catches the rejection but trusts any 200 body passes one and not the other. The
// unhealthy state is identified relative to the healthy one — the same text in both is the
// failure S8 and S9 exist to catch — so each case renders the ok state as its reference.
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from '@jest/globals';
import { digest } from '@cheq/core/testing';

import { App } from '../../src/App.tsx';
import { cleanup, healthBadge, installFetch, json, routes } from './support/http.ts';

const textForHealth = async (health: () => Promise<Response>): Promise<string> => {
  cleanup();
  installFetch(routes({ tasks: () => Promise.resolve(json([])), health }));
  render(<App />);
  const badge = await waitFor(() => healthBadge());
  return (badge.textContent ?? '').trim();
};

const OK = (): Promise<Response> => Promise.resolve(json({ status: 'ok' }));

/** The indicator's text for a `/health` that answers `{ status }`, as a digestible value. */
const observe = async (status: string): Promise<string> =>
  digest(await textForHealth(() => Promise.resolve(json({ status }))));

describe('CHQ-003 S9', () => {
  it('S9_shows_the_unhealthy_state_when_health_rejects', async () => {
    expect.hasAssertions();
    const rejected = await textForHealth(() => Promise.reject(new Error('the API is down')));
    const healthy = await textForHealth(OK);

    expect(rejected.length).toBeGreaterThan(0);
    expect(rejected).not.toBe(healthy);
  });

  it('S9_shows_the_unhealthy_state_when_status_is_not_ok', async () => {
    expect.hasAssertions();
    const degraded = await textForHealth(() => Promise.resolve(json({ status: 'degraded' })));
    const rejected = await textForHealth(() => Promise.reject(new Error('the API is down')));
    const healthy = await textForHealth(OK);

    expect(degraded).not.toBe(healthy);
    expect(degraded).toBe(rejected);
  });

  it('S9_influence_status_value_differs', async () => {
    expect.hasAssertions();
    const ok = await observe('ok');
    const degraded = await observe('degraded');
    expect(degraded).not.toBe(ok);
  });
});
