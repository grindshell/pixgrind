import { describe, expect, it } from 'vitest';
import { deflate, fromBase64, inflate, toBase64 } from './bytes.ts';

describe('base64', () => {
  it('round-trips every byte value', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });

  it('handles data longer than one encoding chunk', () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => (i * 31) & 0xff);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });

  it('matches the standard encoding', () => {
    expect(toBase64(new TextEncoder().encode('pixel'))).toBe('cGl4ZWw=');
    expect(toBase64(new Uint8Array())).toBe('');
  });

  it('rejects text that is not base64', () => {
    expect(() => fromBase64('not base64!')).toThrow();
  });
});

describe('deflate / inflate', () => {
  it('round-trips and compresses repetitive data', async () => {
    const bytes = new Uint8Array(64 * 64).fill(3);
    const compressed = await deflate(bytes);
    expect(compressed.length).toBeLessThan(100);
    expect(await inflate(compressed, bytes.length)).toEqual(bytes);
  });

  it('returns shorter output as is', async () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    expect(await inflate(await deflate(bytes), 10)).toEqual(bytes);
  });

  it('stops at maxLength instead of expanding without limit', async () => {
    const compressed = await deflate(new Uint8Array(1_000_000));
    await expect(inflate(compressed, 1000)).rejects.toThrow(RangeError);
  });

  it('rejects corrupt data', async () => {
    await expect(inflate(Uint8Array.from([1, 2, 3, 4, 5]), 100)).rejects.toThrow();
  });
});
