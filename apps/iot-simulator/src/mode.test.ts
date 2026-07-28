import { describe, expect, it } from 'vitest';
import { parseMode } from './mode.js';

describe('parseMode', () => {
  it('keeps the M00 simulator non-publishing in dry-run mode', () => {
    expect(parseMode(['--dry-run'])).toBe('dry-run');
  });

  it('selects the explicit emergency publish mode', () => {
    expect(parseMode(['--emergency'])).toBe('emergency');
  });

  it('uses connection-only mode by default', () => {
    expect(parseMode([])).toBe('connect');
  });
});
