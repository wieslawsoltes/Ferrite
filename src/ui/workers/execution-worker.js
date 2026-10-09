import {WebAssemblyRuntime} from '../../runtime/WebAssemblyRuntime.js';
import {MirVirtualMachine} from '../../runtime/MirVirtualMachine.js';
let machine = null, running = false, breakpoints = [], lastOutput = '', skipLine = null;
const options = {maxSteps: 1_000_000, maxOutput: 200_000, maxTrace: 0, maxDepth: 128};
const errorData = error => ({type: 'error', message: error.message, code: error.code ?? 'RUNTIME', span: error.span ?? machine?.nextSpan() ?? null});
function output() {
  const current = machine.runtime.output;
  if (current !== lastOutput) { postMessage({type: 'output', text: current}); lastOutput = current; }
}
function publish() { output(); postMessage({type: machine.done ? 'done' : 'paused', state: machine.snapshot()}); }
function pump() {
  if (!running || !machine) return;
  try {
    for (let i = 0; i < 4000 && !machine.done; i++) {
      const span = machine.nextSpan();
      if (skipLine && (span?.file !== skipLine.file || span?.line !== skipLine.line)) skipLine = null;
      if (!skipLine && span && breakpoints.some(b => b.file === span.file && b.line === span.line)) { running = false; publish(); return; }
      machine.step({capture: false});
    }
    output(); if (machine.done) { running = false; publish(); } else setTimeout(pump, 0);
  } catch (error) { running = false; postMessage(errorData(error)); }
}
async function runTests(functions, tests) {
  const results = [];
  for (const test of tests) {
    let status = test.ignore ? 'ignored' : 'passed', message = '', caught = null;
    if (!test.ignore) {
      machine = new MirVirtualMachine(functions, {...options, entry: test.instance});
      try { while (!machine.done) { for (let i = 0; i < 4000 && !machine.done; i++) machine.step({capture: false}); await new Promise(resolve => setTimeout(resolve, 0)); } }
      catch (error) { caught = error; }
      if (!!caught !== !!test.shouldPanic) { status = 'failed'; message = caught?.message ?? 'Expected panic did not occur'; }
      // Execution budgets must never count as an expected panic.
      if (caught?.code === 'R_BUDGET') { status = 'failed'; message = caught.message; }
    }
    const result = {...test, status, message}; results.push(result); postMessage({type: 'test', result});
  }
  postMessage({type: 'tests-done', results});
}
self.onmessage = ({data}) => {
  try {
    if (data.command === 'start') {
      if(data.backend==='wasm'&&data.mode==='run'){const wasm=new WebAssemblyRuntime(data.wasm,options),state=wasm.run({entry:data.entry});postMessage({type:'done',state:{...state,backend:'wasm',frames:[]}});return;}
      if(data.backend==='wasm'&&data.mode==='test'){
        const results=[];for(const test of data.tests??[]){let status=test.ignore?'ignored':'passed',caught=null;
          if(!test.ignore){try{new WebAssemblyRuntime(data.wasm,options).run({entry:test.instance});}catch(error){caught=error;}
            if(!!caught!==!!test.shouldPanic||['R_BUDGET','R_STACK'].includes(caught?.code))status='failed';}
          const result={...test,status,message:status==='failed'?caught?.message??'Expected panic did not occur':''};results.push(result);postMessage({type:'test',result});
        }postMessage({type:'tests-done',results});return;
      }
      if (data.mode === 'test') { runTests(data.functions, data.tests ?? []).catch(e => postMessage(errorData(e))); return; }
      machine = new MirVirtualMachine(data.functions, {...options, entry: data.entry, history: data.mode === 'debug'}); breakpoints = data.breakpoints ?? [];
      if (data.mode === 'debug') publish(); else { running = true; pump(); }
    } else if (data.command === 'pause') { running = false; publish(); }
    else if (data.command === 'continue') { if (!running && !machine?.done) { breakpoints = data.breakpoints ?? []; skipLine = machine.nextSpan(); running = true; pump(); } }
    else if (!running && machine && data.command === 'back') { machine.stepBack(); publish(); }
    else if (!running && machine && data.command === 'back-line') { machine.stepBackLine(); publish(); }
    else if (!running && machine && !machine.done && data.command === 'step') { machine.step({capture: false}); publish(); }
    else if (!running && machine && !machine.done && data.command === 'step-line') { machine.stepLine(); publish(); }
  } catch (error) { running = false; postMessage(errorData(error)); }
};
