/*
 * Byte helpers for file formats: base64 and zlib compression. They use only
 * APIs Node has too (btoa/atob, compression streams), so formats built on
 * them are unit-tested in Node.
 */

/** Characters per `String.fromCharCode` call; well under engines' argument limits. */
const CHUNK = 0x8000;

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

/** Throws on text that isn't base64. */
export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 16-bit values as little-endian bytes, whatever the platform's byte order. */
export function uint16ToBytes(values: Uint16Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < values.length; i++) view.setUint16(i * 2, values[i], true);
  return bytes;
}

/** Reads little-endian 16-bit values. Throws on an odd number of bytes. */
export function bytesToUint16(bytes: Uint8Array): Uint16Array {
  if (bytes.length % 2 !== 0) throw new RangeError('Expected an even number of bytes');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values = new Uint16Array(bytes.length / 2);
  for (let i = 0; i < values.length; i++) values[i] = view.getUint16(i * 2, true);
  return values;
}

/** Compresses with zlib ("deflate"). */
export async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Decompresses zlib data. Rejects on corrupt data, and stops as soon as the
 * output would exceed `maxLength`, so a tiny malicious file can't expand to
 * gigabytes.
 */
export async function inflate(bytes: Uint8Array<ArrayBuffer>, maxLength: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const out = new Uint8Array(maxLength);
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (length + value.length > maxLength) {
      await reader.cancel();
      throw new RangeError(`Decompressed data is larger than ${maxLength} bytes`);
    }
    out.set(value, length);
    length += value.length;
  }
  return length === maxLength ? out : out.slice(0, length);
}
