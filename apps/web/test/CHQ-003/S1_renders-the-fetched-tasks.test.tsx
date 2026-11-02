// CHQ-003 S1 — the response's tasks are the list, in the response's order, and nothing else.
//
// The one structural choice this file fixes, because "row" must be countable for the
// assertion to mean anything: a task is a `listitem`. A title is asserted as a SUBSTRING of
// its row's text and never as the whole of it, so a row may also carry the created date
// without changing this file's verdict.
import { render } from '@testing-library/react';
import { describe, expect, it } from '@jest/globals';
import { digest } from '@cheq/core/testing';

import { App } from '../../src/App.tsx';
import { cleanup, installFetch, json, pending, rowTexts, routes, task, waitForRows } from './support/http.ts';

type Fixture = ReturnType<typeof task>;

const mount = (...tasks: readonly Fixture[]): void => {
  installFetch(routes({ tasks: () => Promise.resolve(json(tasks)), health: () => pending() }));
  render(<App />);
};

/** The list as rendered for `tasks`, as one digestible value. */
const observe = async (...tasks: readonly Fixture[]): Promise<string> => {
  cleanup();
  mount(...tasks);
  await waitForRows(tasks.length);
  return digest(rowTexts());
};

describe('CHQ-003 S1', () => {
  it('S1_renders_both_titles_in_the_order_the_response_listed_them', async () => {
    expect.hasAssertions();
    mount(task('a', 'Alpha'), task('b', 'Beta'));

    await waitForRows(2);
    const rows = rowTexts();
    expect(rows[0] ?? '').toContain('Alpha');
    expect(rows[1] ?? '').toContain('Beta');
  });

  it('S1_renders_no_row_the_response_did_not_carry', async () => {
    expect.hasAssertions();
    mount(task('only', 'The one task'));

    await waitForRows(1);
    expect(rowTexts()[0] ?? '').toContain('The one task');
  });

  it('S1_influence_order_differs', async () => {
    expect.hasAssertions();
    const ab = await observe(task('a', 'Alpha'), task('b', 'Beta'));
    const ba = await observe(task('b', 'Beta'), task('a', 'Alpha'));
    expect(ba).not.toBe(ab);
  });

  it('S1_influence_title_text_differs', async () => {
    expect.hasAssertions();
    const alpha = await observe(task('a', 'Alpha'));
    const gamma = await observe(task('a', 'Gamma'));
    expect(gamma).not.toBe(alpha);
  });
});
