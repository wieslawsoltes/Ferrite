import {ProjectExporter} from "./ide/ProjectExporter.js";
import {EditorGutter} from "./ide/EditorGutter.js";
import {ProjectTree} from "./ide/ProjectTree.js";
import {CommandPalette} from "./ide/CommandPalette.js";
import {CargoToolWindow} from "./ide/CargoToolWindow.js";
import {SourceNavigator} from "./ide/SourceNavigator.js";
import {CallGraphView} from "./visualizers/CallGraphView.js";
import {compileProject} from "./project.js";
import {sampleProjects} from "./samples.js";
import {createProject,parseManifest} from "./cargo.js";
import {createVisualizer,renderCfg,renderInstances} from "./visualizers.js";
const $=id=>document.getElementById(id);
const storageKey="ferrite-workspace-v2";
let files=createProject(),file="src/main.rs",compilation=null,stage="AST",auto=true,timer=null,worker=null,diagnostic=null;
const tree=createVisualizer($("inspector-content"),loc=>navigator.jump(loc));
const navigator=new SourceNavigator(()=>compilation,()=>files,open,()=> $("source"));
const callGraph=new CallGraphView($("inspector-content"),loc=>navigator.jump(loc));
const gutter=new EditorGutter($("gutter"),$("source"),()=>compile(true));
const projectTree=new ProjectTree($("project-tree"),path=>{open(path);schedule();});
const cargoWindow=new CargoToolWindow($("cargo-toolwindow"),()=>files,command=>{
 $("cargo-toolwindow").classList.add("hidden");
 if(command==="test"){diagnostics("Cargo test requires the real Cargo toolchain; browser compiler only supports a Rust subset.");return;}
 compile(command==="run");
});
const palette=new CommandPalette(document.body,()=>[
 {label:"Run current crate",execute:()=>compile(true)},
 {label:"Export project for native Cargo",execute:()=>ProjectExporter.download(files)},
 {label:"Check current crate",execute:()=>compile(false)},
 {label:"Cargo tool window",execute:()=>showCargo()},
 {label:"Reset window layout",execute:()=> $("reset-layout").click()},
 ...Object.keys(files).map(path=>({label:"Open file: "+path,execute:()=>open(path)})),
 ...Object.keys(sampleProjects).map(name=>({label:"Sample: "+name,execute:()=>chooseSample(name)})),
 ...(compilation?.stages||[]).map(s=>({label:"Compiler stage: "+s.name,execute:()=>{stage=s.name;renderStage();}}))
]);
function save(){try{localStorage.setItem(storageKey,JSON.stringify({files,file,auto}));}catch{}}
function restore(){try{const v=JSON.parse(localStorage.getItem(storageKey)||"null");if(v&&v.files&&typeof v.files==="object"){files=v.files;file=v.file in files?v.file:Object.keys(files)[0];auto=v.auto!==false;}}catch{}}
function extension(path){return path.endsWith(".rs")?"rs":path.endsWith(".toml")?"toml":"text";}
function jump(loc,path){const p=path||"src/main.rs";if(p in files&&p!==file)open(p);const text=$("source"),lines=text.value.split("\n");let index=0;for(let i=0;i<Math.max(0,loc.line-1)&&i<lines.length;i++)index+=lines[i].length+1;index+=Math.max(0,loc.column-1);text.focus();text.setSelectionRange(index,index+1);text.scrollTop=Math.max(0,(loc.line-8)*21);}
function open(path){if(!(path in files))return;files[file]=$("source").value;file=path;$("source").value=files[path];$("editor-file").textContent=path;$("dirty").textContent="";renderProject();save();}
function renderProject(){
 $("project-tree").replaceChildren();$("open-files").replaceChildren();
 projectTree.render(files,file);
 for(const path of Object.keys(files).filter(x=>x.endsWith(".rs")||x==="Cargo.toml")){const b=document.createElement("button");b.className="tab"+(path===file?" active":"");b.textContent=path.split("/").at(-1);b.onclick=()=>{open(path);schedule();};$("open-files").append(b);}
 $("editor-file").textContent=file;$("auto").checked=auto;gutter.render();
}
function visitSelection(loc){navigator.jump(loc);}
function renderStage(){
 if(!compilation)return;
 $("inspector-tabs").replaceChildren();
 for(const s of compilation.stages){const b=document.createElement("button");b.className="tab"+(s.name===stage?" active":"");b.textContent=s.name;b.onclick=()=>{stage=s.name;renderStage();};$("inspector-tabs").append(b);}
 const data=compilation.stages.find(s=>s.name===stage)?.data;
 const root=$("inspector-content");
 if(stage==="MIR / CFG")renderCfg(root,data,visitSelection);
 else if(stage==="Call Graph")callGraph.render(data);
 else if(stage==="Generic Instances")renderInstances(root,data,visitSelection);
 else if(stage==="JavaScript"){const pre=document.createElement("pre");pre.className="code-view";pre.textContent=data;root.replaceChildren(pre);}
 else tree.render(data);
 $("passes").replaceChildren();const total=compilation.timings.reduce((s,x)=>s+x.ms,0)||1;
 for(const p of compilation.timings){const row=document.createElement("div");row.className="pass";const name=document.createElement("span");name.textContent=p.name;const track=document.createElement("div");track.className="meter";const fill=document.createElement("div");fill.style.width=Math.max(2,p.ms/total*100)+"%";track.append(fill);const ms=document.createElement("span");ms.textContent=p.ms.toFixed(3)+" ms";row.append(name,track,ms);$("passes").append(row);}
}
function diagnostics(message){$("terminal").textContent=message;$("status").textContent=message.startsWith("error")?"Compilation failed":message;}
function compile(run=false){
 worker?.terminate();worker=null;files[file]=$("source").value;save();
 try {
  compilation=compileProject(files);
  renderStage();diagnostics("✓ Cargo check · "+compilation.sem.instances.length+" instances · "+compilation.timings.reduce((a,b)=>a+b.ms,0).toFixed(2)+" ms");
  if(run)execute();
 }catch(e){compilation=null;diagnostics("error: "+e.message);$("inspector-content").textContent=e.message;}
}
function execute(){
 if(!compilation)return;
 const blob=new Blob(["onmessage=()=>{\n"+compilation.js+"\n}"],{type:"text/javascript"});
 const url=URL.createObjectURL(blob);const current=new Worker(url);worker=current;URL.revokeObjectURL(url);
 const timeout=setTimeout(()=>{current.terminate();if(worker===current){worker=null;diagnostics("Execution timed out (1500 ms)");}},1500);
 current.onmessage=e=>{clearTimeout(timeout);diagnostics("cargo run\n"+String(e.data));current.terminate();if(worker===current)worker=null;};
 current.onerror=e=>{clearTimeout(timeout);diagnostics("error: "+e.message);current.terminate();if(worker===current)worker=null;};
 current.postMessage(null);
}
function schedule(){if(!auto)return;clearTimeout(timer);timer=setTimeout(()=>compile(false),280);}
function chooseSample(name){files=createProject(sampleProjects[name]);file="src/main.rs";$("source").value=files[file];renderProject();compile(true);}
function createFile(){const path=prompt("New file path (e.g. src/utils.rs):");if(!path)return;if(!/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+$/.test(path)||path.includes("..")){alert("Invalid file path");return;}if(path in files){open(path);return;}files[path]=path.endsWith(".rs")?"// New Rust module\n":"";renderProject();open(path);save();}
function removeFile(){if(file==="Cargo.toml"||file==="src/main.rs"){alert("Cannot delete the manifest or entry point");return;}if(!confirm("Delete "+file+"?"))return;delete files[file];file="src/main.rs";$("source").value=files[file];renderProject();compile(false);}
$("export-project").onclick=()=>{files[file]=$("source").value;ProjectExporter.download(files);};
$("run").onclick=()=>compile(true);$("check").onclick=()=>compile(false);$("new-file").onclick=createFile;$("delete-file").onclick=removeFile;
$("auto").onchange=e=>{auto=e.target.checked;save();if(auto)schedule();};
$("source").addEventListener("input",()=>{files[file]=$("source").value;$("dirty").textContent="●";save();schedule();});
$("source").addEventListener("click",()=>{if(compilation){const loc=navigator.sourceToMerged(file,$("source").selectionStart);if(loc)tree.select(loc);}});
$("source").addEventListener("keyup",()=>{if(compilation){const loc=navigator.sourceToMerged(file,$("source").selectionStart);if(loc)tree.select(loc);}});
$("source").addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){e.preventDefault();compile(true);}if(e.key==="Tab"){e.preventDefault();const t=e.target;t.setRangeText("    ",t.selectionStart,t.selectionEnd,"end");files[file]=t.value;schedule();}});
for(const name of Object.keys(sampleProjects)){const option=document.createElement("option");option.value=name;option.textContent=name;$("examples").append(option);}
$("examples").onchange=e=>chooseSample(e.target.value);
for(const button of document.querySelectorAll("[data-pane]"))button.onclick=()=>{const target=$(button.dataset.pane);target.classList.toggle("hidden");button.classList.toggle("active",!target.classList.contains("hidden"));};
const layoutKey="ferrite-ide-layout-v1";
for(const splitter of document.querySelectorAll("[data-split]")){let down=null;splitter.onpointerdown=e=>{down={x:e.clientX,y:e.clientY,left:parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--project-width"))||255,right:parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--inspector-width"))||420,bottom:parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bottom-height"))||230};splitter.setPointerCapture(e.pointerId);};splitter.onpointermove=e=>{if(!down)return;const prop=splitter.dataset.split;if(prop==="left")document.documentElement.style.setProperty("--project-width",Math.max(150,Math.min(500,down.left+e.clientX-down.x))+"px");if(prop==="right")document.documentElement.style.setProperty("--inspector-width",Math.max(220,Math.min(800,down.right+down.x-e.clientX))+"px");if(prop==="bottom")document.documentElement.style.setProperty("--bottom-height",Math.max(100,Math.min(520,down.bottom+down.y-e.clientY))+"px");};splitter.onpointerup=()=>{down=null;try{localStorage.setItem(layoutKey,JSON.stringify(["--project-width","--inspector-width","--bottom-height"].map(k=>document.documentElement.style.getPropertyValue(k))));}catch{}};}
try{const values=JSON.parse(localStorage.getItem(layoutKey)||"null");if(Array.isArray(values))["--project-width","--inspector-width","--bottom-height"].forEach((k,i)=>{if(/^\d+px$/.test(values[i]||""))document.documentElement.style.setProperty(k,values[i]);});}catch{}
$("reset-layout").onclick=()=>{for(const k of ["--project-width","--inspector-width","--bottom-height"])document.documentElement.style.removeProperty(k);for(const name of ["project","inspector","bottom"])$(name).classList.remove("hidden");try{localStorage.removeItem(layoutKey);}catch{}};
function showCargo(){const popup=$("cargo-toolwindow");popup.classList.toggle("hidden");if(!popup.classList.contains("hidden"))cargoWindow.render();}
$("cargo").onclick=()=>{stage="Cargo";compile(false);showCargo();};
document.addEventListener("keydown",event=>{
 if((event.ctrlKey||event.metaKey)&&event.shiftKey&&event.key.toLowerCase()==="p"){event.preventDefault();palette.open();}
 if(event.altKey&&event.key==="1"){event.preventDefault();$("project").classList.toggle("hidden");}
 if(event.key==="Escape"){$("cargo-toolwindow").classList.add("hidden");palette.close();}
});
restore();$("source").value=files[file]??"";renderProject();compile(false);
