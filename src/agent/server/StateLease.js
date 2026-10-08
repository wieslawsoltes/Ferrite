import {open, readFile, lstat, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {AgentError} from '../core/AgentError.js';

/** Conservative cross-process ownership: never guess that a crashed writer is safe to replace. */
export class StateLease {
  static async acquire(root) {
    const lease = new StateLease(); lease.path = join(root, 'runtime.lock'); lease.nonce = randomUUID();
    let handle;
    try { handle = await open(lease.path, 'wx', 0o600); }
    catch (error) {
      if (error.code === 'EEXIST') throw new AgentError('STATE_BUSY', `Agent state is already owned: ${lease.path}. Stop the other bridge/agent first. After a crash, remove this lock only after verifying that its recorded PID is no longer running. Use --state for a separate agent instance.`, {status: 409});
      throw error;
    }
    try { await handle.writeFile(JSON.stringify({pid: process.pid, nonce: lease.nonce, createdAt: new Date().toISOString()})); await handle.sync(); }
    catch (error) { await unlink(lease.path).catch(() => {}); throw error; }
    finally { await handle.close(); }
    return lease;
  }
  async release() {
    if (this.released) return; this.released = true;
    try {
      const stat = await lstat(this.path);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 4096) return;
      const owner = JSON.parse(await readFile(this.path, 'utf8'));
      if (owner.nonce === this.nonce) await unlink(this.path);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
