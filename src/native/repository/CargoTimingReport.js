import {join, relative} from 'node:path';
import {createHash} from 'node:crypto';
import {RepositoryPolicy as P} from './RepositoryPolicy.js';

/** Read Cargo's actual HTML report, never relabeling an unchanged earlier report as this build. */
export class CargoTimingReport {
  static async capture(session) {
    const target = session.metadata?.target_directory ?? join(session.root, 'target');
    const file = join(target, 'cargo-timings', 'cargo-timing.html');
    if (!P.contains(session.root, file)) throw Error('Cargo timing directory is outside the selected repository root');
    const {bytes} = await P.read(session.root, relative(session.root, file).replaceAll('\\','/'), 2 * 1024 * 1024);
    return {html: new TextDecoder('utf-8', {fatal: true}).decode(bytes), fingerprint: createHash('sha256').update(bytes).digest('hex')};
  }
  static async fingerprint(session) { try { return (await this.capture(session)).fingerprint; } catch { return null; } }
  static async read(session, previous = null) {
    try {
      const report = await this.capture(session);
      if (report.fingerprint === previous) return {omitted: 'Cargo did not replace the previous timing report; it is not shown as a new measurement'};
      return {html: report.html};
    } catch (error) { return {omitted: error.code === 'ENOENT' ? 'Cargo did not emit a timing report' : error.message}; }
  }
}
