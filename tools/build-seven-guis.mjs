import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {UIProject} from '../src/ui-framework/UIProject.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(root,'examples/7guis'),definitions=JSON.parse(fs.readFileSync(path.join(directory,'catalog.json'),'utf8'));
if(definitions.map(item=>item.id).join(',')!=='counter,temperature,flight,timer,crud,circles,cells')throw Error('The 7GUIs catalog needs seven unique tasks');
const css=fs.readFileSync(path.join(directory,'styles.css'),'utf8');
const samples=definitions.map((item,order)=>{
  if(!/^[a-z]+$/.test(item.id))throw Error('Invalid sample id');
  const files=Object.fromEntries(fs.readdirSync(path.join(directory,item.id)).filter(file=>file.endsWith('.rs')).sort().map(file=>['src/'+file,fs.readFileSync(path.join(directory,item.id,file),'utf8')]));
  const entry='src/main.ui.rs',project=UIProject.load(files,entry,{css});Object.assign(files,project.changes({maxSteps:item.maxSteps}));
  files['README.md']=`# ${item.title}\n\n${item.description}\n\nOpen src/main.ui.rs in Code / Split / Design / Preview. All state transitions and domain logic are editable Rust; the generated JavaScript, checked WebAssembly and MIR backends share the same compiler pipeline. The browser UI ABI is used; this sample is not a standalone Cargo project.\n\nReference: https://eugenkiss.github.io/7guis/tasks/\n`;
  return {...item,id:'7guis-'+item.id,slug:item.id,order:order+1,category:'7GUIs',kind:'ui',entry,files};
});
const output='// Generated from examples/7guis by tools/build-seven-guis.mjs; edit the Rust sources, not this file.\nexport const SEVEN_GUIS = Object.freeze('+JSON.stringify(samples,null,2)+');\n';
const target=path.join(root,'src/ui/model/SevenGuisCatalog.js');
if(process.argv.includes('--check')){if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==output)throw Error('7GUIs catalog is stale; run node tools/build-seven-guis.mjs');console.log('Verified seven Rust/view! sample projects');}
else{fs.writeFileSync(target,output);console.log('Generated seven Rust/view! sample projects');}
