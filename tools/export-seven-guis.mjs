import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SEVEN_GUIS} from '../src/ui/model/SevenGuisCatalog.js';
import {UICompiler} from '../src/ui-framework/UICompiler.js';
import {UIProject} from '../src/ui-framework/UIProject.js';
import {exportHTML} from '../src/ui-framework/Export.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'artifacts/7guis/exports');fs.mkdirSync(out,{recursive:true});
const report=[];
for(const sample of SEVEN_GUIS){
  const project=UIProject.load(sample.files,sample.entry),artifact=UICompiler.compile(sample.files[sample.entry],{files:sample.files,file:sample.entry,entry:project.settings.entry,maxSteps:sample.maxSteps});
  for(const backend of ['javascript','mir','wasm']){
    const name=`${sample.slug}-${backend}.html`,html=exportHTML(artifact,{backend,title:sample.title,css:project.css});fs.writeFileSync(path.join(out,name),html);report.push({sample:sample.id,backend,file:name,bytes:Buffer.byteLength(html)});
  }
}
fs.writeFileSync(path.join(out,'index.json'),JSON.stringify(report,null,2)+'\n');console.log(`Exported ${report.length} complete standalone HTML applications`);
