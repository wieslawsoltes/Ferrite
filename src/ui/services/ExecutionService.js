/** Disposable execution worker; no generated source is evaluated in the page. */
export class ExecutionService {
  constructor(onEvent) { this.onEvent = onEvent; this.worker = null; this.generation = 0; }
  start(build, mode, breakpoints = [], backend = 'browser') {
    this.stop(false); const generation = ++this.generation;
    this.worker = new Worker(new URL('../workers/execution-worker.bundle.js', import.meta.url));
    this.worker.onmessage = ({data}) => { if (generation === this.generation) { if(data.type==='paused')clearTimeout(this.timeout);this.onEvent(data); if (data.type === 'done' || data.type === 'tests-done' || data.type === 'error') this.stop(false); } };
    this.worker.onerror = event => { if (generation === this.generation) { this.onEvent({type: 'error', message: event.message}); this.stop(false); } };
    this.worker.postMessage({command: 'start', functions: build.optimizedMir, entry: build.entry, tests: build.tests, mode, breakpoints, backend, wasm: backend==='wasm'?build.wasm:null});
    this.timeout = setTimeout(() => { this.onEvent({type: 'error', message: 'Execution worker deadline exceeded'}); this.stop(false); }, 30000);
  }
  command(command, breakpoints = []) { if(!this.worker)return;if(command==='continue'){clearTimeout(this.timeout);this.timeout=setTimeout(()=>{this.onEvent({type:'error',message:'Execution worker deadline exceeded'});this.stop(false);},30000);}this.worker?.postMessage({command, breakpoints}); }
  stop(notify = true) { this.generation++; clearTimeout(this.timeout); this.worker?.terminate(); this.worker = null; if (notify) this.onEvent({type: 'stopped'}); }
}
