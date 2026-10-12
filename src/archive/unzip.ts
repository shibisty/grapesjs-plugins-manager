import { unzipSync } from 'fflate';
import { PluginsManagerError, errorMessage } from '../core/errors';

export type ArchiveInput = Blob | ArrayBuffer | Uint8Array;

/** Archive entries: path → bytes. Directories and junk are skipped. */
export type ArchiveFiles = Record<string, Uint8Array>;

export async function toBytes(input: ArchiveInput): Promise<Uint8Array> {
  // No `instanceof`: buffers from another realm (iframe, worker) must work too.
  if (ArrayBuffer.isView(input)) {
    const v = input as unknown as ArrayBufferView;
    return v instanceof Uint8Array ? v : new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  }
  if (Object.prototype.toString.call(input) === '[object ArrayBuffer]') return new Uint8Array(input as ArrayBuffer);
  if (typeof (input as Blob).arrayBuffer === 'function') return new Uint8Array(await (input as Blob).arrayBuffer());
  // Old engines (and old jsdom) without Blob#arrayBuffer.
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(new Uint8Array(fr.result as ArrayBuffer));
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(input as Blob);
  });
}

/** "PK\x03\x04" (local file header) or "PK\x05\x06" (empty archive). */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06))
  );
}

/** Entries nobody wants: macOS resource forks, dependencies, dotfiles. */
export function isJunk(path: string): boolean {
  return (
    path.endsWith('/') ||
    path.startsWith('__MACOSX/') ||
    /(^|\/)node_modules\//.test(path) ||
    /(^|\/)\.[^/]+$/.test(path) ||
    /(^|\/)\.[^/]+\//.test(path)
  );
}

/**
 * Unpacks a zip. `maxSize` caps the total uncompressed size (zip bombs):
 * the sizes from the central directory are checked BEFORE inflating.
 */
export function unzip(bytes: Uint8Array, maxSize: number): ArchiveFiles {
  if (!looksLikeZip(bytes)) throw new PluginsManagerError('notZip', 'Not a zip archive');
  let total = 0;
  let tooLarge = false;
  let out: ArchiveFiles;
  try {
    // fflate tells files from folders with `instanceof Uint8Array`.
    const own = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    out = unzipSync(own, {
      filter: (f) => {
        if (isJunk(f.name)) return false;
        total += f.originalSize;
        if (total > maxSize) tooLarge = true;
        return !tooLarge;
      },
    });
  } catch (e) {
    throw new PluginsManagerError('notZip', 'Broken zip archive', errorMessage(e));
  }
  if (tooLarge) throw new PluginsManagerError('tooLarge', `Archive is larger than ${maxSize} bytes uncompressed`);
  return out;
}
