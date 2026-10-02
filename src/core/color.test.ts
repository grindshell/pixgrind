import { describe, expect, it } from 'vitest';
import { alpha, blue, green, packRgba, parseHex, red, toHex } from './color.ts';

describe('packRgba', () => {
  it('packs channels as 0xRRGGBBAA and reads them back', () => {
    const c = packRgba(0x12, 0x34, 0x56, 0x78);
    expect(c).toBe(0x12345678);
    expect([red(c), green(c), blue(c), alpha(c)]).toEqual([0x12, 0x34, 0x56, 0x78]);
  });

  it('defaults to opaque and stays unsigned', () => {
    const c = packRgba(255, 0, 0);
    expect(c).toBe(0xff0000ff);
    expect(c).toBeGreaterThan(0);
  });
});

describe('parseHex', () => {
  it('parses #rrggbb as opaque', () => {
    expect(parseHex('#ff004d')).toBe(0xff004dff);
  });

  it('parses #rrggbbaa, without # and in any case', () => {
    expect(parseHex('FF004D80')).toBe(0xff004d80);
    expect(parseHex('  #AbCdEf  ')).toBe(0xabcdefff);
  });

  it.each(['', '#fff', '#12345', '#1234567', '#gggggg'])('rejects %j', (hex) => {
    expect(() => parseHex(hex)).toThrow();
  });
});

describe('toHex', () => {
  it('omits alpha when opaque', () => {
    expect(toHex(0x00e436ff)).toBe('#00e436');
  });

  it('includes alpha when translucent', () => {
    expect(toHex(0x00000000)).toBe('#00000000');
    expect(toHex(0x29adff80)).toBe('#29adff80');
  });

  it('round-trips through parseHex', () => {
    for (const hex of ['#000000', '#ffffff', '#1d2b53', '#ff77a8cc']) {
      expect(toHex(parseHex(hex))).toBe(hex);
    }
  });
});
