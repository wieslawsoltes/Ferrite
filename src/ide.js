import {compile} from "./engine.js";
const $=id=>document.getElementById(id);
const samples={
"Hello World / Generics":'fn greet<T: Display>(value: T) { println!("Hello, {}!", value); }\nfn main() { greet("World"); greet(42u32); }',
"Math / precedence":'fn main() { let x = 2u32 + 3u32 * 4u32; println!("Math: {}", x); }',
"Control flow":'fn main() { let mut n = 0u32; while n < 5u32 { println!("Step {}", n); n += 1u32; } if n == 5u32 { println!("Complete"); } }',
"Boolean logic":'fn main() { let a = true; let b = false; if a && !b { println!("Boolean success"); } }',
"Arrays / indexing":'fn main() { let values = [10u32, 20u32, 30u32]; println!("Second: {}", values[1u32]); }',
"Functions / return values":'fn square(x: u32) -> u32 { x * x }\nfn main() { let value = square(7u32); println!("Square: {}", value); }',
"Early return":'fn classify(x: u32) -> u32 { if x > 10u32 { return 1u32; } return 0u32; }\nfn main() { println!("Class {}", classify(20u32)); }',
"Mutable variables":'fn main() { let mut score = 10u32; score += 5u32; println!("Score {}", score); }',
"Trait obligation error":'fn show<T: MissingTrait>(x: T) { println!("{}", x); }\nfn main() { show(12u32); }',
"Type mismatch":'fn show(x: u32) { println!("{}", x); }\nfn main() { show("text"); }'
};
let worker=null,active="MIR",result=null,openEditor="main.rs",panel="Project";
function addTab(root,name,chosen,click){const b=document.createElement("button");b.className="tab"+(name===chosen?" active":"");b.textContent=name;b.onclick=click;root.append(b);}
function render(){
  if(!result)return;
  $("inspector-tabs").replaceChildren();
  const values={"Tokens":result.tokens,"AST":result.ast,"Types":result.sem,"MIR":result.mir,"JavaScript":result.js};
  Object.keys(values).forEach(name=>addTab($("inspector-tabs"),name,active,()=>{active=name;render();}));
  $("inspector-content").textContent=active==="JavaScript"?result.js:JSON.stringify(values[active],null,2);
  $("passes").replaceChildren();const total=result.timings.reduce((a,b)=>a+b.ms,0)||1;
  for(const pass of result.timings){const item=document.createElement("div");item.className="pass";const label=document.createElement("span");label.textContent=pass.name;const meter=document.createElement("div");meter.className="meter";const fill=document.createElement("div");fill.style.width=Math.max(2,100*pass.ms/total)+"%";meter.append(fill);const value=document.createElement("span");value.textContent=pass.ms.toFixed(2)+" ms";item.append(label,meter,value);$("passes").append(item);}
  $("status").textContent="Compiled • "+result.sem.instances.length+" instances • "+total.toFixed(2)+" ms";
  $("symbols").replaceChildren();
  for(const symbol of result.sem.symbols){const item=document.createElement("div");item.className="tree-item";item.textContent=(symbol.kind==="fn"?"ƒ ":"◇ ")+symbol.name+" : "+symbol.kind;item.onclick=()=>{$("source").focus();$("source").setSelectionRange(0,0);};$("symbols").append(item);}
}
function compileAndRun(){
  worker?.terminate();worker=null;$("terminal").textContent="";const code=$("source").value;
  try {result=compile(code);render();const blob=new Blob(["onmessage=()=>{\n"+result.js+"\n}"],{type:"text/javascript"}),url=URL.createObjectURL(blob);
    worker=new Worker(url);URL.revokeObjectURL(url);const current=worker;
    const timeout=setTimeout(()=>{current.terminate();if(worker===current){worker=null;$("terminal").textContent="Execution timeout (1.5s)";}},1500);
    current.onmessage=e=>{clearTimeout(timeout);$("terminal").textContent=String(e.data)||"(no output)";current.terminate();if(worker===current)worker=null;};
    current.onerror=e=>{clearTimeout(timeout);$("terminal").textContent=e.message;current.terminate();if(worker===current)worker=null;};
    current.postMessage(null);
  }catch(e){result=null;$("terminal").textContent="error: "+e.message;$("status").textContent="Compilation failed";$("inspector-content").textContent=e.stack||e.message;}
}
$("run").onclick=compileAndRun;
$("examples").onchange=()=>{$("source").value=samples[$("examples").value];openEditor=$("examples").value+".rs";$("editor-file").textContent=openEditor;compileAndRun();};
for(const name of Object.keys(samples)){const o=document.createElement("option");o.value=name;o.textContent=name;$("examples").append(o);}
$("source").value=samples[Object.keys(samples)[0]];
$("source").addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){e.preventDefault();compileAndRun();}if(e.key==="Tab"){e.preventDefault();const el=e.target,start=el.selectionStart;el.setRangeText("    ",start,el.selectionEnd,"end");}});
$("source").addEventListener("input",()=>{$("dirty").textContent="●";});
for(const button of document.querySelectorAll("[data-pane]"))button.onclick=()=>{const name=button.dataset.pane;const pane=$(name);pane.classList.toggle("hidden");button.classList.toggle("active",!pane.classList.contains("hidden"));};
const storageKey="ferrite-ide-layout-v1";
for(const splitter of document.querySelectorAll("[data-split]")){let down=null;splitter.addEventListener("pointerdown",e=>{e.preventDefault();down={x:e.clientX,y:e.clientY,left:parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--project-width"))||255,right:parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--inspector-width"))||420,bottom:parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bottom-height"))||230};splitter.setPointerCapture(e.pointerId);});splitter.addEventListener("pointermove",e=>{if(!down)return;const prop=splitter.dataset.split;if(prop==="left")document.documentElement.style.setProperty("--project-width",Math.max(150,Math.min(500,down.left+e.clientX-down.x))+"px");if(prop==="right")document.documentElement.style.setProperty("--inspector-width",Math.max(220,Math.min(800,down.right+down.x-e.clientX))+"px");if(prop==="bottom")document.documentElement.style.setProperty("--bottom-height",Math.max(100,Math.min(520,down.bottom+down.y-e.clientY))+"px");});splitter.addEventListener("pointerup",()=>{down=null;try{localStorage.setItem(storageKey,JSON.stringify(["--project-width","--inspector-width","--bottom-height"].map(k=>document.documentElement.style.getPropertyValue(k))));}catch{}});}
try{const values=JSON.parse(localStorage.getItem(storageKey)||"null");if(Array.isArray(values))["--project-width","--inspector-width","--bottom-height"].forEach((k,i)=>{if(/^\d+px$/.test(values[i]||""))document.documentElement.style.setProperty(k,values[i]);});}catch{}
$("reset-layout").onclick=()=>{for(const key of ["--project-width","--inspector-width","--bottom-height"])document.documentElement.style.removeProperty(key);for(const name of ["project","inspector","bottom"]){$(name).classList.remove("hidden");}try{localStorage.removeItem(storageKey);}catch{}};
compileAndRun();
