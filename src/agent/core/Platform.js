/** Web-platform primitives shared by Node and the static browser IDE. */
export function randomUUID() {
  const crypto = globalThis.crypto;
  if (crypto?.randomUUID) return crypto.randomUUID();
  if (!crypto?.getRandomValues) throw Error('Secure random generation is unavailable');
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export async function contentHash(text) {
  if (text === null) return null;
  if (typeof text !== 'string') throw Error('Content hash requires text or null');
  if (!globalThis.crypto?.subtle) throw Error('Browser agent requires HTTPS or localhost for Web Crypto');
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}
export function sleep(ms, value, {signal} = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener('abort', abort); resolve(value); };
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal.reason ?? new DOMException('Cancelled', 'AbortError')); };
    const timer = setTimeout(finish, ms); signal?.addEventListener('abort', abort, {once: true});
  });
}
