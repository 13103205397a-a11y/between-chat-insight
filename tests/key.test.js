import { describe, expect, it } from 'vitest';
import { resolveApiKey } from '../server/key.js';

describe('temporary API key', () => {
  it('prefers the key supplied for this request', () => {
    expect(resolveApiKey('  temporary-key  ', 'server-key')).toBe('temporary-key');
    expect(resolveApiKey(undefined, 'server-key')).toBe('server-key');
  });

  it('rejects missing and malformed keys', () => {
    expect(resolveApiKey(undefined, undefined)).toBeNull();
    expect(resolveApiKey('bad\nkey', undefined)).toBeNull();
    expect(resolveApiKey('x'.repeat(513), undefined)).toBeNull();
  });
});
