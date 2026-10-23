import { describe, expect, it } from 'vitest';
import { parseEntry } from './parse';

// Smoke tests for the entry classifier; feature suites live beside their modules.
describe('parseEntry', () => {
  it('classifies the core entry kinds', () => {
    expect(parseEntry('y = sin(x)').kind).toBe('function');
    expect(parseEntry("y' = -y").kind).toBe('ode');
    expect(parseEntry('a = 2').kind).toBe('variable');
    expect(parseEntry('x^2 + y^2 = 4').kind).toBe('implicit');
    expect(parseEntry('').kind).toBe('empty');
  });
});
