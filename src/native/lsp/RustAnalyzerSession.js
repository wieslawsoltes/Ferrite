import {VirtualFileSystem} from '../../project/VirtualFileSystem.js';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {JsonRpcPeer} from './JsonRpcPeer.js';
import {LanguageResultMapper} from './LanguageResultMapper.js';
import {ProjectMaterializer} from '../ProjectMaterializer.js';
import {WorkspaceEditPlan} from '../../ui/model/WorkspaceEditPlan.js';

/** One lazily started installed rust-analyzer with an isolated, trusted virtual project. */
export class RustAnalyzerSession {
  static methods=new Set(['textDocument/completion','textDocument/hover','textDocument/definition','textDocument/references','textDocument/rename','textDocument/documentSymbol','textDocument/signatureHelp']);
  constructor({spawnProcess=spawn,project=null}={}){this.spawnProcess=spawnProcess;this.project=project;this.borrowed=!!project;this.peer=null;this.child=null;this.documents=new Map();this.busy=false;this.status=null;this.stderr='';this.optionsKey=null;}
  config(options={}){return {linkedProjects:[join(this.project.root,this.project.manifest??'Cargo.toml')],checkOnSave:false,cargo:{extraEnv:{CARGO_NET_OFFLINE:options.offline===false?'false':'true'},buildScripts:{enable:options.expandNativeMacros===true},features:options.allFeatures?'all':options.features??[],noDefaultFeatures:options.defaultFeatures===false,targetDir:join(this.project.root,'target-ra')},procMacro:{enable:options.expandNativeMacros===true},cachePriming:{enable:false}};}
  async start(snapshot,options,signal){
    if(this.peer&&!this.peer.closed)return;
    if(this.child)await this.terminate();
    if(!this.project)this.project=await ProjectMaterializer.create(snapshot);else await this.project.update(snapshot);
    this.stderr='';this.status=null;this.documents.clear();
    this.child=this.spawnProcess('rust-analyzer',[],{cwd:this.project.root,env:process.env,shell:false,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});
    const child=this.child;this.exited=new Promise(resolve=>{child.once('close',resolve);child.once('error',resolve);});
    child.stderr.on('data',bytes=>{this.stderr=(this.stderr+bytes.toString('utf8')).slice(-32768);});
    this.peer=new JsonRpcPeer(child.stdout,child.stdin,{
      onNotification:(method,params)=>{if(method==='experimental/serverStatus')this.status=params;},
      onRequest:async(method,params)=>{
        if(method==='workspace/configuration')return (params?.items??[]).map(()=>this.config(this.options));
        if(method==='workspace/applyEdit')return {applied:false,failureReason:'Ferrite requires explicit preview and confirmation'};
        return null;
      }
    });
    const peer=this.peer;
    child.once('error',error=>peer.close(new Error('Install rust-analyzer with rustup component add rust-analyzer rust-src: '+error.message)));
    child.once('close',()=>peer.close(new Error('rust-analyzer exited. '+this.stderr.slice(-2000))));
    const rootUri=pathToFileURL(this.project.root).href;
    try{
      this.options=options;this.optionsKey=JSON.stringify(options);
      this.capabilities=await this.peer.request('initialize',{processId:process.pid,clientInfo:{name:'Ferrite',version:'0.9.0'},rootUri,
        workspaceFolders:[{uri:rootUri,name:'Ferrite project'}],
        capabilities:{general:{positionEncodings:['utf-16']},workspace:{configuration:true,applyEdit:false,workspaceFolders:true},
          textDocument:{synchronization:{didSave:true},completion:{completionItem:{snippetSupport:false,documentationFormat:['plaintext'],insertReplaceSupport:true}},hover:{contentFormat:['plaintext']},definition:{linkSupport:true},rename:{prepareSupport:false}},
          experimental:{serverStatusNotification:true}},initializationOptions:this.config(options)},{timeoutMs:30000,signal});
      if(this.capabilities?.capabilities?.positionEncoding&&this.capabilities.capabilities.positionEncoding!=='utf-16')throw Error('Language server did not negotiate UTF-16 positions');
      this.peer.notify('initialized',{});
    }catch(error){await this.terminate();throw new Error('rust-analyzer initialization failed: '+error.message+(this.stderr?' · '+this.stderr.slice(-1500):''));}
  }
  async synchronize(snapshot,options,signal){
    const old=new Map(this.project?.previous??[]);await this.start(snapshot,options,signal);await this.project.update(snapshot);
    if(JSON.stringify(options)!==this.optionsKey){this.options=options;this.optionsKey=JSON.stringify(options);this.peer.notify('workspace/didChangeConfiguration',{settings:this.config(options)});}
    const fileUri=path=>pathToFileURL(join(this.project.root,path)).href,changed=[];
    for(const [path,document] of this.documents)if(!Object.hasOwn(snapshot.files,path)){this.peer.notify('textDocument/didClose',{textDocument:{uri:fileUri(path)}});this.documents.delete(path);}
    for(const [path,text] of Object.entries(snapshot.files)){
      if(old.get(path)!==text)changed.push({uri:fileUri(path),type:old.has(path)?2:1});
      if(!path.endsWith('.rs'))continue;const document=this.documents.get(path);
      if(!document){this.documents.set(path,{text,version:1});this.peer.notify('textDocument/didOpen',{textDocument:{uri:fileUri(path),languageId:'rust',version:1,text}});}
      else if(document.text!==text){document.text=text;document.version++;this.peer.notify('textDocument/didChange',{textDocument:{uri:fileUri(path),version:document.version},contentChanges:[{text}]});}
    }
    for(const path of old.keys())if(!Object.hasOwn(snapshot.files,path))changed.push({uri:fileUri(path),type:3});
    if(changed.length)this.peer.notify('workspace/didChangeWatchedFiles',{changes:changed});
  }
  async ready(signal){
    const deadline=Date.now()+30000;await delay(75,null,{signal});
    while(!this.status?.quiescent){
      if(this.peer.closed)throw Error('rust-analyzer stopped: '+this.stderr.slice(-2000));
      if(Date.now()>deadline)throw Error('rust-analyzer did not finish loading the Cargo workspace: '+(this.status?.message??''));
      await delay(50,null,{signal});
    }
  }
  async request(snapshot,method,{file,position,newName,options={},signal}={}){
    if(!RustAnalyzerSession.methods.has(method))throw Error('Unsupported language operation');
    if(this.busy)throw Error('A language operation is already running');
    const files=this.borrowed?VirtualFileSystem.validate(snapshot?.files):ProjectMaterializer.validate(snapshot);
    if(!Object.hasOwn(files,file)||!file.endsWith('.rs'))throw Error('Select a Rust source file from this project');
    if(method!=='textDocument/documentSymbol')WorkspaceEditPlan.offset(files[file],position);
    if(method==='textDocument/rename'&&(typeof newName!=='string'||newName.length>1000||!/^(?:r#)?[\p{ID_Start}_][\p{ID_Continue}]*$/u.test(newName)))throw Error('Enter a valid Rust identifier');
    if(!options||typeof options!=='object'||Array.isArray(options))throw Error('Invalid language configuration');
    if(options.features&&(!Array.isArray(options.features)||options.features.some(f=>typeof f!=='string'||f.length>1000)))throw Error('Invalid language feature configuration');
    this.busy=true;
    try{
      if(signal?.aborted)throw new DOMException('Cancelled','AbortError');await this.synchronize({files},options,signal);await this.ready(signal);
      const params={textDocument:{uri:pathToFileURL(join(this.project.root,file)).href}};
      if(position)params.position=position;if(method==='textDocument/references')params.context={includeDeclaration:true};if(method==='textDocument/rename')params.newName=newName;
      let raw;
      for(let attempt=0;attempt<4;attempt++)try{raw=await this.peer.request(method,params,{signal});break;}catch(error){if(![-32801,-32802].includes(error.code)||attempt===3)throw error;await delay(100,null,{signal});}
      return {backend:'rust-analyzer',method,...new LanguageResultMapper(this.project.root,files).map(method,raw,file,position)};
    }finally{this.busy=false;}
  }
  async terminate(){
    this.peer?.close();this.peer=null;const child=this.child;this.child=null;if(!child)return;
    const kill=signal=>{try{if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,signal);else child.kill(signal);}catch{}};
    kill('SIGTERM');const timer=setTimeout(()=>kill('SIGKILL'),750);try{await this.exited;}finally{clearTimeout(timer);}this.documents.clear();
  }
  async dispose(){await this.terminate();await this.project?.dispose();this.project=null;}
}
