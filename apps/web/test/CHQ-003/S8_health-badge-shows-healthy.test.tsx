// CHQ-003 S8 — a healthy `/health` shows the healthy state, and text is what distinguishes it.
//
// The indicator is addressed as the live region whose accessible name names health
// (`role="status"`, name /health/i) — "health" is the vision's own word and the endpoint's.
// Nothing here asserts a literal badge copy: "distinguishable by text, not by colour alone"
// is proved by rendering BOTH states and comparing their texts, which invents no string and
// fails exactly when the two states read the same.
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from '@jest/globals';

import { App } from '../../src/App.tsx';
import { cleanup, healthBadge, installFetch, json, routes } from './support/http.ts';

const mountWithHealth = (body: unknown): void => {
  installFetch(routes({ tasks: () => Promise.resolve(json([])), health: () => Promise.resolve(json(body)) }));
  render(<App />);
};

/** The indicator's text when `/health` answers `body`. */
const textFor = async (body: unknown): Promise<string> => {
  cleanup();
  mountWithHealth(body);
  const badge = await waitFor(() => healthBadge());
  return (badge.textContent ?? '').trim();
};

describe('CHQ-003 S8', () => {
  it('S8_shows_the_healthy_state_when_health_resolves_ok', async () => {
    expect.hasAssertions();
    mountWithHealth({ status: 'ok' });

    const badge = await waitFor(() => healthBadge());
    expect((badge.textContent ?? '').trim().length).toBeGreaterThan(0);
  });

  it('S8_the_healthy_and_unhealthy_states_differ_by_text', async () => {
    expect.hasAssertions();
    const healthy = await textFor({ status: 'ok' });
    const unhealthy = await textFor({ status: 'degraded' });
    expect(healthy.length).toBeGreaterThan(0);
    expect(unhealthy.length).toBeGreaterThan(0);
    expect(unhealthy).not.toBe(healthy);
  });
});
