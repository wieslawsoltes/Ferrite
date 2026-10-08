/** Explicitly bounded browser workspace shell, not a POSIX OS or native Cargo emulator. */
export class VirtualShell {
  static commands = ['help','pwd','cd','ls','cat','echo','printf','head','tail','wc','grep','find','sort','uniq','cut','tr','touch','mkdir','rm','cp','mv','basename','dirname','clear','history','true','false','date','env','export','which'];
  constructor(model) { this.model = model; this.cwd = ''; this.directories = new Set(['']); this.history = []; this.env = {HOME:'/',TERM:'ferrite-browser',SHELL:'ferrite-sh'}; this.lastCode = 0; }
  resolve(path = '.') {
    const parts = path.startsWith('/') || path.startsWith('~') ? [] : this.cwd.split('/').filter(Boolean);
    for (const part of path.replace(/^~/,'').split('/')) { if (!part || part === '.') continue; if (part === '..') parts.pop(); else parts.push(part); }
    return parts.join('/');
  }
  files() { return this.model.files; }
  directory(path) { return this.directories.has(path) || Object.keys(this.files()).some(file => file.startsWith(path ? path + '/' : '')); }
  read(path) { const file = this.resolve(path); if (!Object.hasOwn(this.files(), file)) throw Error(`${path}: no such file`); return this.files()[file]; }
  write(path, text) {
    const file = this.resolve(path); if (text.length > 2 * 1024 * 1024) throw Error('Browser shell output exceeds 2 MiB');
    if (Object.hasOwn(this.files(), file)) this.model.update(file, text); else this.model.create(file, text);
  }
  tokenize(command) {
    if (command.length > 65536) throw Error('Command exceeds 64 KiB');
    const tokens = []; let value = '', quote = '', started = false;
    const push = () => { if (started) { tokens.push({word:value}); value='';started=false; } };
    for (let i=0;i<command.length;i++) {
      const ch=command[i];
      if (ch==='\\' && quote!=="'") { if (++i>=command.length) throw Error('Trailing escape');value+=command[i];started=true;continue; }
      if (quote) { if(ch===quote)quote='';else if(ch==='$'&&quote==='"'){const match=/^(\w+|\?)/.exec(command.slice(i+1));if(match){value+=this.variable(match[1]);i+=match[1].length;}else value+=ch;}else value+=ch;continue; }
      if(ch==='"'||ch==="'"){quote=ch;started=true;continue;}
      if(ch==='#'&&!started)break;
      if(/\s/.test(ch)){push();continue;}
      if(ch==='`'||ch==='$'&&command[i+1]==='(')throw Error('Command substitution is not implemented; use a native terminal');
      if(ch==='$'){const match=/^(\w+|\?)/.exec(command.slice(i+1));if(match){value+=this.variable(match[1]);i+=match[1].length;started=true;continue;}}
      if('|&;><'.includes(ch)){push();let op=ch;if(command[i+1]===ch&&['|','&','>'].includes(ch))op+=command[++i];if(op==='&')throw Error('Background jobs require a native terminal');tokens.push({op});continue;}
      value+=ch;started=true;
    }
    if(quote)throw Error('Unclosed quote');push();return tokens;
  }
  variable(name){return name==='PWD'?'/'+this.cwd:name==='?'?String(this.lastCode):this.env[name]??'';}
  async execute(command) {
    this.history.push(command);if(this.history.length>200)this.history.shift();
    try {
      const tokens=this.tokenize(command);let index=0,output='',code=0,condition=';',clear=false;
      while(index<tokens.length){
        const pipeline=[];let separator=';';
        while(index<tokens.length){
          const words=[];let input=null,redirect=null,append=false;
          while(index<tokens.length&&!['|',';','&&','||'].includes(tokens[index].op)){
            const token=tokens[index++];
            if(token.op){const next=tokens[index++];if(!next||next.word===undefined)throw Error('Redirection requires a file');if(token.op==='<')input=next.word;else if(['>','>>'].includes(token.op)){redirect=next.word;append=token.op==='>>';}else throw Error('Unsupported shell operator');}
            else words.push(token.word);
          }
          if(!words.length)throw Error('Expected a command');pipeline.push({words,input,redirect,append});
          const op=tokens[index++]?.op;if(op==='|')continue;separator=op??';';break;
        }
        const run=condition===';'||condition==='&&'&&code===0||condition==='||'&&code!==0;
        if(run){let data='';for(const stage of pipeline){const result=await this.command(stage.words,stage.input===null?data:this.read(stage.input));data=result.text??'';code=result.code??0;clear ||=result.clear===true;if(data.length>2*1024*1024)throw Error('Pipeline output exceeds 2 MiB');if(stage.redirect!==null){this.write(stage.redirect,(stage.append?(()=>{try{return this.read(stage.redirect);}catch{return '';}})():'')+data);data='';}}output+=data;if(output.length>2*1024*1024)throw Error('Output exceeds 2 MiB');}
        condition=separator;
      }
      this.lastCode=code;return {text:output,code,clear};
    }catch(error){this.lastCode=1;return {text:'ferrite-sh: '+error.message+'\n',code:1};}
  }
  async command([name,...args],stdin){
    const out=text=>({text,code:0}),fileArgs=args.filter(arg=>!arg.startsWith('-'));
    const data=()=>fileArgs.length?fileArgs.map(path=>this.read(path)).join(''):stdin;
    switch(name){
      case 'help':return out('Browser workspace utilities (bounded subsets):\n'+VirtualShell.commands.join(' ')+'\nQuotes, pipes, < > >>, ; && || and environment variables are supported.\nNative Cargo, Rust, Git, full Unix tools and coding CLIs require the Agent bridge / Native terminal.\n');
      case 'pwd':return out('/'+this.cwd+'\n');
      case 'cd':{const next=this.resolve(args[0]??'/');if(!this.directory(next))throw Error('Not a directory: '+next);this.cwd=next;return out('');}
      case 'ls':{const target=this.resolve(fileArgs[0]??'.');if(Object.hasOwn(this.files(),target))return out(target.split('/').at(-1)+'\n');if(!this.directory(target))throw Error('Not a directory: '+target);const prefix=target?target+'/':'',entries=new Set();for(const path of [...Object.keys(this.files()),...this.directories])if(path.startsWith(prefix)&&path!==target){const tail=path.slice(prefix.length),first=tail.split('/')[0];if(first&&(args.includes('-a')||!first.startsWith('.')))entries.add(first+(tail.includes('/')||this.directories.has(prefix+first)?'/':''));}return out([...entries].sort().join('\n')+'\n');}
      case 'cat':return out(data());
      case 'echo':return out((args[0]==='-n'?args.slice(1):args).join(' ')+(args[0]==='-n'?'':'\n'));
      case 'printf':{let i=1;return out((args[0]??'').replace(/\\n/g,'\n').replace(/\\t/g,'\t').replace(/%%|%s|%d/g,s=>s==='%%'?'%':s==='%d'?String(Number(args[i++])||0):args[i++]??''));}
      case 'head':case 'tail':{let count=10,paths=[];for(let i=0;i<args.length;i++){if(args[i]==='-n'){count=Number(args[++i]);if(!Number.isInteger(count)||count<0||count>1000000)throw Error('Invalid line count');}else paths.push(args[i]);}const text=paths.length?paths.map(path=>this.read(path)).join(''):stdin,lines=text.match(/[^\n]*\n|[^\n]+$/g)??[];return out((name==='head'?lines.slice(0,count):count?lines.slice(-count):[]).join(''));}
      case 'wc':{const source=data(),lines=(source.match(/\n/g)??[]).length,words=(source.match(/\S+/g)??[]).length,bytes=new TextEncoder().encode(source).length;return out((args.includes('-l')?String(lines):args.includes('-w')?String(words):args.includes('-c')?String(bytes):`${lines} ${words} ${bytes}`)+'\n');}
      case 'grep':{const flags=new Set(args.filter(a=>a.startsWith('-')).join('').replace(/-/g,'')),query=fileArgs[0];if(query===undefined)throw Error('grep requires literal text');const sources=fileArgs.length>1?fileArgs.slice(1).map(path=>({path,text:this.read(path)})):[{path:'',text:stdin}];const result=[];for(const source of sources)source.text.split('\n').forEach((line,index)=>{const match=(flags.has('i')?line.toLowerCase():line).includes(flags.has('i')?query.toLowerCase():query);if(match!==flags.has('v'))result.push((sources.length>1?source.path+':':'')+(flags.has('n')?index+1+':':'')+line);});return {text:result.length?result.join('\n')+'\n':'',code:result.length?0:1};}
      case 'find':{const root=this.resolve(args[0]??'.'),pattern=args.includes('-name')?args[args.indexOf('-name')+1]:null;const matcher=pattern?new RegExp('^'+pattern.replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\?/g,'.')+'$'):null;return out(Object.keys(this.files()).filter(file=>(!root||file===root||file.startsWith(root+'/'))&&(!matcher||matcher.test(file.split('/').at(-1)))).sort().join('\n')+'\n');}
      case 'sort':{let lines=data().split('\n');if(lines.at(-1)==='')lines.pop();lines.sort(args.includes('-n')?(a,b)=>Number(a)-Number(b):undefined);if(args.includes('-r'))lines.reverse();if(args.includes('-u'))lines=[...new Set(lines)];return out(lines.join('\n')+(lines.length?'\n':''));}
      case 'uniq':{const lines=data().split('\n');if(lines.at(-1)==='')lines.pop();const result=[];for(let i=0;i<lines.length;){let j=i+1;while(lines[j]===lines[i]&&j<lines.length)j++;result.push((args.includes('-c')?(j-i)+' ':'')+lines[i]);i=j;}return out(result.join('\n')+(result.length?'\n':''));}
      case 'cut':{const delimiter=args.includes('-d')?args[args.indexOf('-d')+1]:'\t',field=Number(args[args.indexOf('-f')+1]);if(!args.includes('-f')||!Number.isSafeInteger(field)||field<1)throw Error('cut supports -d delimiter -f positive-field');return out(stdin.split('\n').map(line=>line.split(delimiter)[field-1]??'').join('\n'));}
      case 'tr':{if(args.length!==2)throw Error('tr supports two literal character sets');const [from,to]=args;return out([...stdin].map(ch=>{const i=from.indexOf(ch);return i<0?ch:to[Math.min(i,to.length-1)]??'';}).join(''));}
      case 'touch':for(const path of args)if(!Object.hasOwn(this.files(),this.resolve(path)))this.write(path,'');return out('');
      case 'mkdir':for(const path of fileArgs)this.directories.add(this.resolve(path));return out('');
      case 'rm':for(const path of fileArgs){const file=this.resolve(path);if(!Object.hasOwn(this.files(),file)){if(!args.includes('-f'))throw Error('No such file: '+path);}else this.model.remove(file);}return out('');
      case 'cp':case 'mv':{if(args.length!==2)throw Error(name+' requires source and destination');const source=this.resolve(args[0]),destination=this.resolve(args[1]);if(source===destination)throw Error('Source and destination are identical');this.write(args[1],this.read(args[0]));if(name==='mv')this.model.remove(source);return out('');}
      case 'basename':return out((args[0]??'').replace(/\/$/,'').split('/').at(-1)+'\n');
      case 'dirname':return out((args[0]??'').split('/').slice(0,-1).join('/')+'\n');
      case 'clear':return {text:'',clear:true};
      case 'history':return out(this.history.map((line,i)=>`${i+1}  ${line}`).join('\n')+'\n');
      case 'true':return out('');case 'false':return {text:'',code:1};
      case 'date':return out(new Date().toISOString()+'\n');
      case 'env':return out(Object.entries({...this.env,PWD:'/'+this.cwd}).map(([key,value])=>key+'='+value).join('\n')+'\n');
      case 'export':for(const item of args){const match=/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(item);if(!match)throw Error('export requires NAME=value');this.env[match[1]]=match[2];}return out('');
      case 'which':return out(args.filter(arg=>VirtualShell.commands.includes(arg)).map(arg=>'/browser/bin/'+arg).join('\n')+'\n');
      default:return {code:127,text:`${name}: not available in the browser shell. Use a native terminal for installed Cargo, Rust, Git, agent CLIs and full Unix tools.\n`};
    }
  }
}
