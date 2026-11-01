import { describe, expect, it } from 'vitest';

import { API_PACKAGE } from '../../src/index.ts';

describe('api skeleton', () => {
  it('names itself', () => {
    expect(API_PACKAGE).toBe('@cheq/api');
  });
});
