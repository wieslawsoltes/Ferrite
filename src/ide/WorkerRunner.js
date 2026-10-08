/**
 * Runs generated JavaScript inside a disposable browser Worker with a deadline.
 * This is isolation for responsiveness, not a secure sandbox.
 */
export class WorkerRunner {
 constructor(timeoutMs=1500){this.timeoutMs=timeoutMs;this.worker=null;this.deadline=null;}
 cancel(){if(this.worker)this.worker.terminate();this.worker=null;if(this.deadline)clearTimeout(this.deadline);this.deadline=null;}
 run(code,{onOutput,onError}){
   this.cancel();
   const blob=new Blob(["onmessage=()=>{\n"+code+"\n}"],{type:"text/javascript"});
   const url=URL.createObjectURL(blob);
   let worker;
   try{worker=new Worker(url);}finally{URL.revokeObjectURL(url);}
   this.worker=worker;
   const finish=(kind,value)=>{if(this.worker!==worker)return;this.cancel();if(kind==="result")onOutput(value);else onError(value);};
   this.deadline=setTimeout(()=>finish("error","Execution timed out ("+this.timeoutMs+" ms)"),this.timeoutMs);
   worker.onmessage=e=>finish("result",String(e.data));
   worker.onerror=e=>finish("error",e.message||"Worker execution error");
   worker.onmessageerror=()=>finish("error","Worker message deserialization error");
   worker.postMessage(null);
 }
}
