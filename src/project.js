import {compile} from "./engine.js";
import {CompilerCache} from "./compiler/CompilerCache.js";
const cache = new CompilerCache(24);
import {cargoPlan,mergeCrateSources,createProject} from "./cargo.js";
export function compileProject(files,command="check"){
 const plan=cargoPlan(files,command);
 if(plan.errors.length)throw new Error(plan.errors.map(e=>e.message).join("; "));
 if(plan.dependencies.length)throw new Error("External Cargo dependencies require a real Cargo toolchain; unresolved: "+plan.dependencies.join(", "));
 const unit=mergeCrateSources(files,plan.entry);
 const cached=cache.get(unit.source);
 const compilation=cached??cache.set(unit.source,compile(unit.source));
 const cacheHit=cached!==undefined;
 return {...compilation,timings:cacheHit?[]:compilation.timings,cacheHit,cache:cache.stats,plan,unit,stages:[
 {name:"Cargo",data:plan},{name:"Modules",data:unit.modules},{name:"Tokens",data:compilation.tokens},
 {name:"AST",data:compilation.ast},{name:"HIR / Symbols",data:compilation.sem.symbols},
 {name:"Types / Traits",data:compilation.sem},{name:"MIR / CFG",data:compilation.mir},
 {name:"Generic Instances",data:compilation.sem.instances},{name:"JavaScript",data:compilation.js}
 ]};
}
