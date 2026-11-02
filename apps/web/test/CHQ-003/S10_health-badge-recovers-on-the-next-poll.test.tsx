// CHQ-003 S10 — the indicator recovers on a later poll, in place, with no reload.
//
// Fake timers are the domain step here rather than a way around one: the assertion IS about
// a poll, so the clock is what the case varies. Both halves the portable subset requires are
// present — a FIXED system time, and an afterEach that restores the real timers whatever the
// case did.
//
// "without the page being reloaded" is formalised as: the very element found while the API
// was down is still connected afterwards and now carries the healthy text. A tree that threw
// its indicator away and mounted a new one fails `isConnected`, which is what a reload would
// look like from inside the document.
import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { App } from '../../src/App.tsx';
import { cleanup, healthBadge, installFetch, json, routes } from './support/http.ts';

const OK = { status: 'ok' };

describe('CHQ-003 S10', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('S10_recovers_to_the_healthy_text_in_place_when_the_next_poll_resolves_ok', async () => {
    expect.hasAssertions();

    // The reference: what the healthy state reads when it is the first thing seen.
    installFetch(routes({ tasks: () => Promise.resolve(json([])), health: () => Promise.resolve(json(OK)) }));
    render(<App />);
    const healthy = ((await waitFor(() => healthBadge())).textContent ?? '').trim();
    cleanup();

    jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00.000Z') });
    let polls = 0;
    installFetch(
      routes({
        tasks: () => Promise.resolve(json([])),
        health: () => {
          polls += 1;
          return polls === 1 ? Promise.reject(new Error('the API is down')) : Promise.resolve(json(OK));
        },
      }),
    );
    render(<App />);

    const badge = await waitFor(() => healthBadge());
    const down = (badge.textContent ?? '').trim();
    expect(down).not.toBe(healthy);

    await jest.advanceTimersByTimeAsync(60_000);
    await waitFor(() => {
      expect((badge.textContent ?? '').trim()).toBe(healthy);
    });

    expect(badge.isConnected).toBe(true);
    expect(polls).toBeGreaterThan(1);
  });
});
