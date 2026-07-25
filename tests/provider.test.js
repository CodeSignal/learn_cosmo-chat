import { describe, it, expect } from 'vitest';
import { usesBedrock } from '../lib/provider.js';

describe('usesBedrock', () => {
  it('is false when the flag is omitted (existing courses)', () => {
    expect(usesBedrock({})).toBe(false);
    expect(usesBedrock()).toBe(false);
  });

  it('is false for any non-true value', () => {
    expect(usesBedrock({ useBedrock: false })).toBe(false);
    expect(usesBedrock({ useBedrock: 'true' })).toBe(false);
    expect(usesBedrock({ useBedrock: 1 })).toBe(false);
    expect(usesBedrock({ useBedrock: null })).toBe(false);
  });

  it('is true only for an explicit boolean true', () => {
    expect(usesBedrock({ useBedrock: true })).toBe(true);
  });
});
