// Skeleton fixture: spec-less, never red-checked, never a spec's check:. It exists so
// the core project has a test to run — a runner that matched zero tests proves nothing,
// so an empty suite must not be able to read as green.
import { describe, expect, it } from '@jest/globals';

import { CORE_PACKAGE } from '../../src/index.ts';

describe('core skeleton', () => {
  it('names itself', () => {
    expect(CORE_PACKAGE).toBe('@cheq/core');
  });
});
