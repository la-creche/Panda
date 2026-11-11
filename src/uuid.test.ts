import { describe, expect, it, vi } from 'vitest';
import { randomUuid, type RandomCrypto } from './uuid';

describe('randomUuid', () => {
  it('uses the platform UUID generator when it is available', () => {
    const native = '11111111-2222-4333-8444-555555555555';
    const getRandomValues = vi.fn();
    const crypto = {
      randomUUID: vi.fn(() => native),
      getRandomValues,
    } as unknown as RandomCrypto;

    expect(randomUuid(crypto)).toBe(native);
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it('makes an RFC 4122 UUID when randomUUID is unavailable', () => {
    const crypto = {
      getRandomValues: vi.fn((bytes: Uint8Array) => {
        bytes.fill(0xff);
        return bytes;
      }),
    } as unknown as RandomCrypto;

    expect(randomUuid(crypto)).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  });
});
