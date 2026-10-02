/**
 * Random 64-bit hex id. Uses `getRandomValues` rather than `randomUUID`, which
 * is unavailable in insecure contexts (e.g. the dev server opened over LAN).
 */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
