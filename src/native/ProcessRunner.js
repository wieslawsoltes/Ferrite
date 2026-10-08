import {spawn} from 'node:child_process';
import {StringDecoder} from 'node:string_decoder';

/** Shell-free child-process lifecycle with bounded logs and cancellation before cleanup. */
export class ProcessRunner {
  constructor({spawnProcess = spawn} = {}) { this.spawnProcess = spawnProcess; }
  run(executable, args, {cwd, env = process.env, timeoutMs = 120000, maxOutputBytes = 8 * 1024 * 1024, signal, onEvent = () => {}} = {}) {
    if (!Array.isArray(args) || args.some(a => typeof a !== 'string' || a.includes('\0'))) return Promise.reject(Error('Invalid process arguments'));
    if (signal?.aborted) return Promise.resolve({exitCode: 130, stdout: '', stderr: '', signal: null, cancelled: true, timedOut: false});
    return new Promise((resolve, reject) => {
      const group = process.platform !== 'win32', child = this.spawnProcess(executable, args, {cwd, env, shell: false, detached: group, stdio: ['ignore', 'pipe', 'pipe']});
      const decoders = {stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8')}, output = {stdout: '', stderr: ''};
      let bytes = 0, timedOut = false, cancelled = false, overflow = false, closed = false, forceTimer;
      const send = name => {
        if (closed) return;
        try { if (group && child.pid) process.kill(-child.pid, name); else child.kill(name); }
        catch (error) { if (error.code !== 'ESRCH') { try { child.kill(name); } catch {} } }
      };
      const terminate = reason => {
        if (closed) return;
        timedOut ||= reason === 'timeout'; cancelled ||= reason === 'cancelled'; overflow ||= reason === 'output';
        send('SIGTERM'); if (!forceTimer) forceTimer = setTimeout(() => send('SIGKILL'), 750);
      };
      const timeout = setTimeout(() => terminate('timeout'), timeoutMs);
      const abort = () => terminate('cancelled'); signal?.addEventListener('abort', abort, {once: true});
      const cleanup = () => { closed = true; clearTimeout(timeout); clearTimeout(forceTimer); signal?.removeEventListener('abort', abort); };
      for (const name of ['stdout', 'stderr']) child[name]?.on('data', chunk => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > maxOutputBytes) { terminate('output'); return; }
        const text = decoders[name].write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); output[name] += text;
        try { onEvent({kind: name, text}); } catch { /* Observers cannot interrupt process cleanup. */ }
      });
      child.once('error', error => { cleanup(); reject(new Error(`${executable}: ${error.message}`, {cause: error})); });
      child.once('close', (code, processSignal) => {
        if (closed) return;
        for (const name of ['stdout', 'stderr']) output[name] += decoders[name].end();
        cleanup();
        const exitCode = timedOut ? 124 : cancelled ? 130 : overflow ? 137 : Number.isInteger(code) ? code : 128;
        resolve({exitCode, ...output, signal: processSignal, timedOut, cancelled, outputLimitExceeded: overflow});
      });
    });
  }
}
