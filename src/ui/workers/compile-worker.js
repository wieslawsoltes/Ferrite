import {CompilerSession} from '../../project/CompilerSession.js';
import {ParserWorkerPool} from '../../project/parallel/ParserWorkerPool.js';
import {VirtualFileSystem} from '../../project/VirtualFileSystem.js';
const session = new CompilerSession();
let pool = null, queue = Promise.resolve();
self.onmessage = ({data}) => {
  // The pool only parallelizes pure per-file lex/parse. Shared compiler state is
  // owned by this worker and every semantic/ownership/verification pass is retained.
  queue = queue.then(async () => {
    const start = performance.now();
    try {
      const files = VirtualFileSystem.validate(data.files), options = data.options ?? {};
      pool ??= new ParserWorkerPool({workerFactory: () => new Worker(data.parserWorkerUrl)});
      const workers = options.parseWorkers || Math.min(4, self.navigator?.hardwareConcurrency || 2);
      const parallel = await pool.prewarm(files, session.syntax, {workers, threshold: options.parseWorkers ? 0 : pool.slots.length ? 8192 : 65536});
      const build = session.compile(files, data.command, options);
      build.parallel = parallel; build.elapsedMs = performance.now() - start;
      self.postMessage({id: data.id, build, revision: data.revision});
    } catch (error) {
      self.postMessage({id: data.id, error: error.toJSON?.() ?? {message: error.message, code: error.code ?? 'COMPILER', span: error.span ?? null}});
    }
  });
};
