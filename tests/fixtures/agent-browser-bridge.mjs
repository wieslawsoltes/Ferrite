// Isolated test fixture: deterministic provider wire responses, real runtime/tools/PTY and HTTP bridge.
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {AgentRuntime} from '../../src/agent/server/AgentRuntime.js';
import {AgentBridgeServer} from '../../src/agent/server/AgentBridgeServer.js';
const root=await mkdtemp(join(tmpdir(),'ferrite-agent-browser-'));
await mkdir(join(root,'workspace/src'),{recursive:true});
await writeFile(join(root,'workspace/Cargo.toml'),'[package]\nname="agent-browser"\nversion="0.1.0"\nedition="2021"\n');
await writeFile(join(root,'workspace/src/main.rs'),'fn main() { println!("Before agent"); }\n');
const transport={async request(url,options){
  if(url.endsWith('/models'))return {data:[{id:'test-tool-model'}]};
  if(!url.endsWith('/responses'))throw Error('Unexpected test provider endpoint');
  const input=options.body.input,lastCall=input.findLast(item=>item.type==='function_call'),lastResult=input.findLast(item=>item.type==='function_call_output');
  let name,args,output;
  if(!lastCall){name='workspace_read';args={path:'src/main.rs'};}
  else if(lastCall.name==='workspace_read'){name='workspace_replace';args={path:'src/main.rs',expectedHash:JSON.parse(lastResult.output).hash,oldText:'Before agent',newText:'Agent integration passed'};}
  else if(lastCall.name==='workspace_replace'){name='compiler_execute';args={mode:'run'};}
  if(name)output=[{type:'function_call',call_id:'call_'+randomUUID(),name,arguments:JSON.stringify(args)}];
  else {output=[{type:'message',role:'assistant',content:[{type:'output_text',text:'Updated src/main.rs and verified the MIR execution: Agent integration passed.'}]}];options.onEvent({type:'response.output_text.delta',delta:'Updated src/main.rs and verified the MIR execution: Agent integration passed.'});}
  options.onEvent({type:'response.completed',response:{status:'completed',output,usage:{input_tokens:50,output_tokens:20}}});return null;
}};
const runtime=await AgentRuntime.create({root:join(root,'workspace'),state:join(root,'state'),environment:{},transport});
const bridge=new AgentBridgeServer(runtime,{origins:[process.argv[2]??'http://localhost:8080']});
const connection=await bridge.listen();console.log(JSON.stringify({...connection,root:runtime.workspace.root}));
let closing=false;async function close(){if(closing)return;closing=true;await bridge.close();await rm(root,{recursive:true,force:true});process.exit();}
process.on('SIGTERM',close);process.on('SIGINT',close);
