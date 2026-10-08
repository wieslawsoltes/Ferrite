import {request as httpRequest} from 'node:http';
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {AgentRuntime} from '../src/agent/server/AgentRuntime.js';import {AgentBridgeServer} from '../src/agent/server/AgentBridgeServer.js';import {McpServer} from '../src/agent/mcp/McpServer.js';import {UnifiedPatch} from '../src/agent/tools/UnifiedPatch.js';import {NativeWorkspace} from '../src/agent/server/NativeWorkspace.js';import {StdioTransport} from '../src/agent/mcp/StdioTransport.js';import {PassThrough,Readable} from 'node:stream';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'ferrite-tools-'));await mkdir(join(root,'workspace'));await mkdir(join(root,'workspace/src'));await writeFile(join(root,'workspace/Cargo.toml'),'[package]\nname="fixture"\nversion="0.1.0"\n');await writeFile(join(root,'workspace/src/main.rs'),'fn main() { println!("Agent hello"); }\n');const runtime=await AgentRuntime.create({root:join(root,'workspace'),state:join(root,'state'),environment:{}});t.after(async()=>{await runtime.close();await rm(root,{recursive:true,force:true});});return runtime;}
const trusted={sessionId:'test',mode:'trusted',interactive:false};
test('unified patches validate all context, offsets, counts and newline markers',()=>{
 assert.equal(UnifiedPatch.apply('a\nb\n','@@ -1,2 +1,2 @@\n a\n-b\n+c\n').text,'a\nc\n');
 assert.equal(UnifiedPatch.apply('a','@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file\n').text,'b');
 assert.equal(UnifiedPatch.apply(null,'@@ -0,0 +1 @@\n+hello\n').text,'hello\n');
 assert.throws(()=>UnifiedPatch.apply('x\n','@@ -1 +1 @@\n-y\n+z\n'),{code:'PATCH_CONTEXT'});
 assert.throws(()=>UnifiedPatch.apply('x\n','@@ -1,2 +1 @@\n-x\n+z\n'),{code:'PATCH_COUNT'});
});
test('registered workspace tools search, replace and restore with conflict checks',async t=>{
 const r=await fixture(t),read=await r.tools.execute('workspace_read',{path:'src/main.rs'});const results=await r.tools.execute('workspace_search',{query:'Agent hello'});assert.equal(results.matches.length,1);
 const edit=await r.tools.execute('workspace_replace',{path:'src/main.rs',expectedHash:read.hash,oldText:'Agent hello',newText:'Changed'},trusted);assert.match(await r.workspace.text('src/main.rs'),/Changed/);
 await assert.rejects(r.tools.execute('workspace_replace',{path:'src/main.rs',expectedHash:read.hash,oldText:'Changed',newText:'Oops'},trusted),{code:'EDIT_CONFLICT'});
 await r.tools.execute('checkpoint_restore',{id:edit.checkpoint},trusted);assert.match(await r.workspace.text('src/main.rs'),/Agent hello/);
});
test('native process arguments preserve boundaries and provider keys are stripped',async t=>{
 const r=await fixture(t);const result=await r.tools.execute('process_exec',{executable:process.execPath,args:['-e','console.log(JSON.stringify(process.argv.slice(1)))','a b','$(not-shell)']},trusted);assert.equal(result.exitCode,0);assert.deepEqual(JSON.parse(result.stdout),['a b','$(not-shell)']);
 await assert.rejects(r.tools.execute('process_exec',{executable:'/bin/echo',args:['x']},{interactive:false}),{code:'APPROVAL_REQUIRED'});
 const timeout=await r.tools.execute('process_exec',{executable:process.execPath,args:['-e','setInterval(()=>{},1000)'],timeoutMs:100},trusted);assert.equal(timeout.timedOut,true);
});
test('compiler tools expose all stages, source hashes and bounded execution',async t=>{
 const r=await fixture(t);const analyze=await r.tools.execute('compiler_analyze',{});assert.ok(analyze.stages.length>=21);assert.ok(analyze.hashes['src/main.rs']);
 const ast=await r.tools.execute('compiler_inspect',{stage:'AST'});assert.ok(ast.data||ast.artifact);
 const run=await r.tools.execute('compiler_execute',{mode:'run'},trusted);assert.equal(run.output,'Agent hello\n');
});
test('agent cannot read another owner’s terminal',async t=>{
 const r=await fixture(t);const terminal=await r.terminals.start({executable:'/bin/sh',args:['-i'],owner:'user'});
 await assert.rejects(r.tools.execute('terminal_read',{id:terminal.id},{sessionId:'agent'}),{code:'TERMINAL_OWNER'});await r.terminals.close(terminal.id);
});
test('MCP legacy handshake, tool calls, resource paths and protocol errors',async t=>{
 const r=await fixture(t),server=new McpServer(r);t.after(()=>server.close());let id=0;
 const send=(method,params={})=>server.handle({jsonrpc:'2.0',id:++id,method,params});
 assert.equal((await send('tools/list')).error.code,-32002);
 assert.equal((await send('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}})).result.protocolVersion,'2025-11-25');
 await server.handle({jsonrpc:'2.0',method:'notifications/initialized'});
 const tools=(await send('tools/list')).result.tools;assert.ok(tools.some(t=>t.name==='rust_language'));assert.equal(tools.length,r.tools.list().length);
 const read=await send('tools/call',{name:'workspace_read',arguments:{path:'src/main.rs'}});assert.equal(read.result.isError,false);
 const denied=await send('tools/call',{name:'process_exec',arguments:{executable:'echo'}});assert.equal(denied.result.isError,true);assert.match(denied.result.content[0].text,/APPROVAL_REQUIRED/);
 const resource=await send('resources/read',{uri:'ferrite://file/src/main.rs'});assert.match(resource.result.contents[0].text,/Agent hello/);
 assert.equal((await send('missing/method')).error.code,-32601);
});
test('MCP modern discovery and metadata work without legacy initialize',async t=>{
 const r=await fixture(t),server=new McpServer(r);t.after(()=>server.close());const params={_meta:McpServer.metadata()};
 const discovery=await server.handle({jsonrpc:'2.0',id:'one',method:'server/discover',params});assert.equal(discovery.result.resultType,'complete');assert.deepEqual(discovery.result.supportedVersions,McpServer.versions);
 const tool=await server.handle({jsonrpc:'2.0',id:2,method:'tools/call',params:{...params,name:'workspace_list',arguments:{}}});assert.equal(tool.result.isError,false);
 const bad=await server.handle({jsonrpc:'2.0',id:3,method:'tools/list',params:{_meta:{...McpServer.metadata(),'io.modelcontextprotocol/protocolVersion':'1900-01-01'}}});assert.equal(bad.error.code,-32022);assert.deepEqual(bad.error.data.supported,McpServer.versions);
});
test('stdio transport supports fragmented Unicode and parse-error recovery',async()=>{
 const input=Readable.from([Buffer.from('{"jsonrpc":"2.0","id":1,"method":"ping","params":{"x":"Żółć"}}\n{bad}\n')]),output=new PassThrough();let result='';output.on('data',data=>result+=data);
 await new StdioTransport(async message=>({jsonrpc:'2.0',id:message.id,result:message.params}),{input,output}).run();const messages=result.trim().split('\n').map(JSON.parse);assert.equal(messages.length,2);assert.ok(messages.some(m=>m.result?.x==='Żółć'));assert.ok(messages.some(m=>m.error?.code===-32700));
});
test('HTTP bridge authenticates, rejects origins and Host spoofing, exposes MCP and workspace transactions',async t=>{
 const r=await fixture(t),server=new AgentBridgeServer(r,{origins:['http://localhost:8080']});const connection=await server.listen();t.after(()=>server.close());const headers={Authorization:'Bearer '+connection.token,'Content-Type':'application/json'};
 assert.equal((await fetch(connection.url+'/v1/capabilities')).status,401);
 assert.equal((await fetch(connection.url+'/v1/capabilities',{headers:{...headers,Origin:'https://evil.invalid'}})).status,403);
 // A non-loopback Host is rejected even with a valid bearer.
 assert.equal(await new Promise((resolve,reject)=>{const request=httpRequest(connection.url+'/v1/capabilities',{headers:{...headers,Host:'evil.invalid'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);request.end();}),403);
 assert.equal((await fetch(connection.url+'/v1/capabilities',{headers})).status,200);
 const update=await fetch(connection.url+'/v1/workspace/apply',{method:'POST',headers,body:JSON.stringify({changes:[{path:'hello.txt',expectedHash:null,text:'world'}]})});assert.equal(update.status,200);assert.equal(await r.workspace.text('hello.txt'),'world');
 const modern={jsonrpc:'2.0',id:1,method:'server/discover',params:{_meta:McpServer.metadata()}};
 const mcp=await fetch(connection.url+'/mcp',{method:'POST',headers:{...headers,Accept:'application/json, text/event-stream','MCP-Protocol-Version':McpServer.versions[0]},body:JSON.stringify(modern)});assert.equal(mcp.status,200);assert.equal((await mcp.json()).result.resultType,'complete');
 assert.equal((await fetch(connection.url+'/mcp',{method:'POST',headers,body:JSON.stringify(modern)})).status,406);
});
