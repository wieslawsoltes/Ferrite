import {performance} from "node:perf_hooks";
import {compile} from "../src/engine.js";
import {compileProject} from "../src/project.js";
import {sampleProjects} from "../src/samples.js";
const iterations=Number(process.argv[2]||100);
if(!Number.isSafeInteger(iterations)||iterations<1||iterations>10000)throw Error("Invalid benchmark iteration count");
const project=sampleProjects["Control-flow and Fibonacci"];
const source=project["src/main.rs"];
const quantile=(values,fraction)=>{const s=values.toSorted((a,b)=>a-b);return s[Math.floor((s.length-1)*fraction)].toFixed(3);};
function benchmark(action){
 const samples=[];
 for(let i=0;i<iterations;i++){const start=performance.now();action(i);samples.push(performance.now()-start);}
 return {p50:quantile(samples,.5),p95:quantile(samples,.95),max:quantile(samples,1)};
}
const cold=benchmark(i=>compile(source.replace("fib(10u32)","fib("+((i%25)+1)+"u32)")));
const warm=benchmark(()=>compileProject(project));
console.log(JSON.stringify({iterations,coldCompileMs:cold,hotProjectCompileMs:warm},null,2));
console.log("Numbers are environment-dependent wall-clock measurements, not universal compiler speedups.");
