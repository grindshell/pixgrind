import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { toHex, type Rgba } from '../core/color.ts';
import { MAX_PALETTE_COLORS } from '../core/palette.ts';
import { createPixelator, type Sampling } from '../core/pixelate.ts';
import type { Dither } from '../core/quantize.ts';
import { parsePaletteText } from '../io/paletteFormats.ts';
import { decodePng, encodeIndexedPng } from '../io/png.ts';

/*
 * The Pixelate dialog's pipeline (`core/pixelate.ts`) as a command, for
 * batches: PNGs in, indexed PNGs out, under the same names. Node runs it as
 * TypeScript directly (`node src/cli/pixelate.ts`, or `pnpm pixelate`).
 */

const USAGE = `Usage: node src/cli/pixelate.ts --out <folder> [options] <png or folder>...

Pixelates PNGs as the Pixelate dialog does, writing each as an indexed PNG of
the same name to the out folder. A folder input means the PNGs directly in it.

Options (defaults are the dialog's):
  -o, --out <folder>     where the results go (required; made if missing)
  --width <n>            result width (64)
  --height <n>           result height (64)
  --sampling <mode>      average | dominant | nearest (average)
  --colors <n>           colors to generate from each image (16)
  --palette <file>       use a .hex, .gpl or .pal palette instead of generating
  --dither <mode>        none | ordered | diffusion (none)
  --strength <0-100>     dithering strength, in percent (50)
  -h, --help             show this`;

/**
 * Larger sources are refused (256 MB as RGBA). The dialog instead shrinks
 * sources over 16 MP smoothly before resampling, so results for those differ
 * slightly; this resamples them whole.
 */
const MAX_SOURCE_PIXELS = 8192 * 8192;

const SAMPLINGS: readonly Sampling[] = ['average', 'dominant', 'nearest'];
const DITHERS: readonly Dither[] = ['none', 'ordered', 'diffusion'];

class UsageError extends Error {}

function integer(name: string, text: string, min: number, max: number): number {
  const value = Number(text);
  if (!Number.isInteger(value) || value < min || value > max) throw new UsageError(`--${name} must be a whole number from ${min} to ${max}`);
  return value;
}

function oneOf<T extends string>(name: string, text: string, choices: readonly T[]): T {
  const choice = choices.find((c) => c === text);
  if (!choice) throw new UsageError(`--${name} must be one of ${choices.join(', ')}`);
  return choice;
}

/** For comparing paths: Windows file names ignore case. */
function pathKey(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

/** The PNGs named, with a folder standing for the PNGs directly in it. */
function expandInputs(paths: readonly string[]): string[] {
  return paths.flatMap((path) => {
    if (!statSync(path).isDirectory()) return [path];
    return readdirSync(path)
      .filter((name) => extname(name).toLowerCase() === '.png')
      .sort()
      .map((name) => join(path, name));
  });
}

async function main(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o' },
      width: { type: 'string', default: '64' },
      height: { type: 'string', default: '64' },
      sampling: { type: 'string', default: 'average' },
      colors: { type: 'string', default: '16' },
      palette: { type: 'string' },
      dither: { type: 'string', default: 'none' },
      strength: { type: 'string', default: '50' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (!values.out) throw new UsageError('--out is required');
  if (positionals.length === 0) throw new UsageError('No inputs given');

  // `pnpm pixelate` runs from this package, so relative paths are the caller's.
  const base = process.env.npm_lifecycle_event === 'pixelate' ? (process.env.INIT_CWD ?? process.cwd()) : process.cwd();
  const width = integer('width', values.width, 1, 1024);
  const height = integer('height', values.height, 1, 1024);
  const sampling = oneOf('sampling', values.sampling, SAMPLINGS);
  const colorCount = integer('colors', values.colors, 1, MAX_PALETTE_COLORS);
  const dither = oneOf('dither', values.dither, DITHERS);
  const ditherStrength = integer('strength', values.strength, 0, 100) / 100;
  let colors: Rgba[] | null = null;
  if (values.palette) {
    const path = resolve(base, values.palette);
    colors = parsePaletteText(path, readFileSync(path, 'utf8'), basename(path)).colors;
  }

  const out = resolve(base, values.out);
  const inputs = expandInputs(positionals.map((path) => resolve(base, path)));
  if (inputs.length === 0) throw new UsageError('No PNGs in the inputs');
  const targets = inputs.map((input) => join(out, basename(input, extname(input)) + '.png'));
  // Refuse before writing anything: a result must never replace a source or another result.
  const sources = new Set(inputs.map(pathKey));
  const seen = new Set<string>();
  for (const target of targets) {
    if (sources.has(pathKey(target))) throw new UsageError(`${target} would overwrite its source; choose another --out`);
    if (seen.has(pathKey(target))) throw new UsageError(`Two inputs would both be written to ${target}`);
    seen.add(pathKey(target));
  }
  mkdirSync(out, { recursive: true });

  let failed = 0;
  for (const [i, input] of inputs.entries()) {
    const name = basename(input);
    try {
      const source = await decodePng(readFileSync(input), MAX_SOURCE_PIXELS);
      const result = createPixelator(source)({ width, height, sampling, colors, colorCount, dither, ditherStrength });
      writeFileSync(targets[i], await encodeIndexedPng(result, result.colors));
      if (Math.abs((source.width * height) / (source.height * width) - 1) > 0.01) {
        console.error(`warning: ${name} is ${source.width}×${source.height}, stretched to ${width}×${height}`);
      }
      console.log(`${name}  ${source.width}×${source.height} → ${width}×${height}  ${result.colors.map(toHex).join(' ')}`);
    } catch (error) {
      failed++;
      console.error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`${inputs.length - failed} of ${inputs.length} pixelated to ${out}`);
  return failed > 0 ? 1 : 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const usage = error instanceof UsageError || (error instanceof Error && 'code' in error && String(error.code).startsWith('ERR_PARSE_ARGS'));
    console.error(error instanceof Error ? error.message : String(error));
    if (usage) console.error('Run with --help for usage.');
    process.exitCode = 2;
  },
);
