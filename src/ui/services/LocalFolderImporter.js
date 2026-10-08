import {VirtualFileSystem as V} from '../../project/VirtualFileSystem.js';

/** Browser-only folder import. A native repository session is needed to retain binary assets. */
export class LocalFolderImporter {
  static async read(list) {
    const files = Object.create(null), omitted = []; let bytes = 0;
    for (const file of [...list].sort((a, b) => a.webkitRelativePath.localeCompare(b.webkitRelativePath))) {
      const raw = file.webkitRelativePath.split('/').slice(1).join('/');
      if (!raw || /(?:^|\/)(?:\.git|target|node_modules)(?:\/|$)/.test(raw) || /(?:^|\/)\.env(?:\.|$)/.test(raw) || /\.(?:pem|key|pfx|p12)$/.test(raw) || /(?:^|\/)\.cargo\/credentials/.test(raw)) continue;
      try {
        const path = V.path(raw);
        if (path !== raw || file.size > 1024 * 1024 || bytes + file.size > V.MAX_BYTES || Object.keys(files).length >= V.MAX_FILES) throw Error('editor limit');
        const buffer = await file.arrayBuffer();
        if (new Uint8Array(buffer).includes(0)) throw Error('binary');
        files[path] = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(buffer); bytes += buffer.byteLength;
      } catch (error) { omitted.push({path: raw, reason: error.message}); }
    }
    if (!files['Cargo.toml']) throw Error('Select a folder containing Cargo.toml. Use Native Repository for nested manifests.');
    return {files: V.validate(files), omitted};
  }
}
