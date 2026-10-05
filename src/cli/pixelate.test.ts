import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { packRgba } from '../core/color.ts';
import { decodePng, encodeIndexedPng } from '../io/png.ts';

const CLI = fileURLToPath(new URL('./pixelate.ts', import.meta.url));

function run(...args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

describe('pixelate command', () => {
  let dir = '';
  let source = '';

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'pixgrind-cli-'));
    source = join(dir, 'split.png');
    // 8×8: the top two rows transparent, then red on the left and blue on the right.
    const pixels = Uint8Array.from({ length: 64 }, (_, i) => (i < 16 ? 0 : i % 8 < 4 ? 1 : 2));
    const colors = [packRgba(255, 0, 0), packRgba(0, 0, 255)];
    writeFileSync(source, await encodeIndexedPng({ width: 8, height: 8, pixels }, colors));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('pixelates a folder of PNGs to indexed PNGs of the same names', async () => {
    const out = join(dir, 'out');
    const result = run('--out', out, '--width', '4', '--height', '4', '--colors', '2', dir);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    // Generated colors are sorted dark to light.
    expect(result.stdout).toContain('split.png  8×8 → 4×4  #0000ff #ff0000');
    const { width, height, data } = await decodePng(readFileSync(join(out, 'split.png')), 1 << 20);
    expect([width, height]).toEqual([4, 4]);
    const at = (x: number, y: number) => [...data.subarray((y * 4 + x) * 4, (y * 4 + x) * 4 + 4)];
    expect(at(0, 0)).toEqual([0, 0, 0, 0]);
    expect(at(0, 1)).toEqual([255, 0, 0, 255]);
    expect(at(3, 3)).toEqual([0, 0, 255, 255]);
  });

  it('refuses to write over its sources, before writing anything', () => {
    const before = readFileSync(source);
    const result = run('--out', dir, source);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('would overwrite its source');
    expect(readFileSync(source)).toEqual(before);
  });

  it('refuses invalid options', () => {
    const out = join(dir, 'out');
    expect(run('--out', out, '--sampling', 'bicubic', source).stderr).toContain('--sampling must be one of');
    const result = run('--out', out, '--colors', '0', source);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--colors must be a whole number from 1 to 255');
  });
});
