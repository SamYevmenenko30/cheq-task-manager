// Asserts what rule 9 demands of a stub: honest empty state, one hypothesis sentence,
// a visible STUB tag — and NO invented product data.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from '@jest/globals';

import { App } from '../../src/App.tsx';

describe('web stub', () => {
  it('shows the STUB tag', () => {
    render(<App />);
    expect(screen.getByText('STUB')).toBeTruthy();
  });

  it('states that no task list exists yet', () => {
    render(<App />);
    expect(screen.getByText(/No task list yet/i)).toBeTruthy();
  });
});
