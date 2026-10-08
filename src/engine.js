// Ferrite language services — deliberately bounded Rust subset, not rustc.
// Each pass returns plain structured data suitable for the compiler explorer.
export function tokenize(source) {
  const tokens=[], rx=/\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])'|(?:\d+\.\d+|\d+)(?:u32|i32|usize|f64)?|[A-Za-z_][A-Za-z_0-9]*|->|=>|==|!=|<=|>=|&&|\|\||\+=|-=|\*=|\/=|::|[{}()[\],;:.!<>+=*\/%&|\-]/gy;
  let offset=0,line=1,column=1;
  while(offset<source.length) {
    rx.lastIndex=offset;const m=rx.exec(source);
    if(!m)throw new Error("Unexpected character '"+source[offset]+"' at "+line+":"+column);
    const value=m[0],start={offset,line,column};
    for(const c of value){if(c==="\n"){line++;column=1;}else column++;}
    offset=rx.lastIndex;
    if(/^\s|^\/\//.test(value)||value.startsWith("/*"))continue;
    tokens.push({value,...start});
  }
  tokens.push({value:"EOF",offset,line,column});return tokens;
}

export function parse(tokens) {
  let i=0;
  const peek=(n=0)=>tokens[i+n]?.value||"EOF",take=()=>tokens[i++],eat=value=>{
    const token=take();if(token.value!==value)throw new Error("Expected '"+value+"', got '"+token.value+"' at "+token.line+":"+token.column);return token;
  },node=(kind,fields,token)=>({kind,...fields,loc:{line:token.line,column:token.column,offset:token.offset}});
  function type() {
    let prefix="";
    if(peek()==="&"){take();prefix="&";if(peek()==="mut"){take();prefix+="mut ";}}
    const t=take();if(!/^[A-Za-z_]/.test(t.value))throw Error("Expected type at "+t.line+":"+t.column);
    let result=prefix+t.value;
    if(peek()==="<"){take();const args=[];while(peek()!==">"){args.push(type());if(peek()!==",")break;take();}eat(">");result+="<"+args.join(",")+">";}
    return result;
  }
  function block() {
    const start=eat("{"),body=[];let tail=null;
    while(peek()!=="}"){
      if(peek()==="EOF")throw Error("Unclosed block at "+start.line+":"+start.column);
      if(peek()==="let"){const t=take(),mutable=peek()==="mut"?!!take():false,name=take().value;let annotation=null;if(peek()===":"){take();annotation=type();}eat("=");const value=expr();eat(";");body.push(node("let",{name,mutable,annotation,value},t));continue;}
      if(peek()==="return"){const t=take(),value=peek()===";"?null:expr();eat(";");body.push(node("return",{value},t));continue;}
      if(peek()==="while"){const t=take(),condition=expr(),then=block();body.push(node("while",{condition,then},t));continue;}
      if(peek()==="loop"){const t=take(),then=block();body.push(node("loop",{then},t));continue;}
      if(peek()==="break"||peek()==="continue"){const t=take();eat(";");body.push(node(t.value,{},t));continue;}
      if(peek()==="if"){const t=take(),condition=expr(),then=block();let otherwise=null;if(peek()==="else"){take();otherwise=peek()==="if"?conditional():block();}body.push(node("if",{condition,then,otherwise},t));continue;}
      if(peek()==="{"){body.push(node("blockStatement",{block:block()},tokens[i]));continue;}
      const value=expr();
      if(peek()==="="||peek()==="+="||peek()==="-="){const op=take().value,right=expr();eat(";");body.push(node("assign",{target:value,op,value:right},tokens[i-1]));}
      else if(peek()===";"){take();body.push(node("expression",{value},tokens[i-1]));}
      else if(peek()==="}"){tail=value;break;}
      else throw Error("Expected ';' or '}' at "+tokens[i].line+":"+tokens[i].column);
    }
    eat("}");return node("block",{body,tail},start);
  }
  function conditional(){const t=eat("if"),condition=expr(),then=block();let otherwise=null;if(peek()==="else"){take();otherwise=peek()==="if"?conditional():block();}return node("ifExpr",{condition,then,otherwise},t);}
  const precedence={"||":1,"&&":2,"==":3,"!=":3,"<":4,">":4,"<=":4,">=":4,"+":5,"-":5,"*":6,"/":6,"%":6};
  function expr(min=0) {
    const start=tokens[i];let left;
    if(peek()==="if"){left=conditional();}
    else if(peek()==="("){take();if(peek()===")"){take();left=node("literal",{value:null,type:"()"},start);}else{left=expr();eat(")");}}
    else if(peek()==="- "||peek()==="-"||peek()==="!"||peek()==="&"||peek()==="*"){const op=take().value;let mutable=false;if(op==="&"&&peek()==="mut"){take();mutable=true;}left=node("unary",{op,mutable,value:expr(7)},start);}
    else if(peek()==="["){take();const items=[];while(peek()!=="]"){items.push(expr());if(peek()!==",")break;take();}eat("]");left=node("array",{items},start);}
    else if(peek()==="true"||peek()==="false"){left=node("literal",{value:take().value==="true",type:"bool"},start);}
    else if(peek().startsWith('"')){const t=take().value;left=node("literal",{value:JSON.parse(t),type:"&str"},start);}
    else if(peek().startsWith("'")){const t=take().value;left=node("literal",{value:t.slice(1,-1),type:"char"},start);}
    else if(/^\d/.test(peek())){const t=take().value;const ty=t.endsWith("f64")||t.includes(".")?"f64":t.endsWith("i32")?"i32":t.endsWith("usize")?"usize":"u32";left=node("literal",{value:Number(t.replace(/(u32|i32|usize|f64)$/,"")),type:ty},start);}
    else {let name=take().value;if(!/^[A-Za-z_]/.test(name))throw Error("Expected expression at "+start.line+":"+start.column);
      while(peek()==="::"){take();name+="::"+take().value;}left=node("variable",{name},start);}
    for(;;){
      if(peek()==="!"&&left.kind==="variable"){take();left={...left,macro:true};continue;}
      if(peek()==="("){take();const args=[];while(peek()!==")"){args.push(expr());if(peek()!==",")break;take();}eat(")");left=node("call",{callee:left,args,macro:!!left.macro},start);continue;}
      if(peek()==="["){take();const index=expr();eat("]");left=node("index",{object:left,index},start);continue;}
      if(peek()==="."){take();const field=take().value;left=node("field",{object:left,field},start);continue;}
      const p=precedence[peek()];if(p===undefined||p<min)break;
      const op=take().value;left=node("binary",{op,left,right:expr(p+1)},start);
    }
    return left;
  }
  const items=[];
  while(peek()!=="EOF"){
    const start=tokens[i];if(peek()==="pub")take();
    if(peek()==="fn"){
      take();const name=take().value,generics=[];
      if(peek()==="<"){take();while(peek()!==">"){const id=take().value,bounds=[];if(peek()===":"){take();bounds.push(type());while(peek()==="+"){take();bounds.push(type());}}generics.push({name:id,bounds});if(peek()!==",")break;take();}eat(">");}
      eat("(");const params=[];while(peek()!==")"){const name=take().value;eat(":");params.push({name,type:type()});if(peek()!==",")break;take();}eat(")");
      let returnType="()";if(peek()==="->"){take();returnType=type();}
      items.push(node("fn",{name,generics,params,returnType,body:block()},start));continue;
    }
    if(peek()==="struct"){take();const name=take().value;eat("{");const fields=[];while(peek()!=="}"){const field=take().value;eat(":");fields.push({name:field,type:type()});if(peek()!==",")break;take();}eat("}");items.push(node("struct",{name,fields},start));continue;}
    throw Error("Unsupported top-level item '"+peek()+"' at "+start.line+":"+start.column);
  }
  return {kind:"crate",items};
}

const isNumber=t=>["u32","i32","f64","usize"].includes(t);
function compatible(expected,actual){return expected===actual||expected==="unknown"||actual==="unknown";}
export function analyze(ast){
  const defs=new Map(),structs=new Map(),instances=new Map(),obligations=[],symbols=[];
  for(const item of ast.items){if(defs.has(item.name)||structs.has(item.name))throw Error("Duplicate item "+item.name);if(item.kind==="fn")defs.set(item.name,item);else structs.set(item.name,item);symbols.push({name:item.name,kind:item.kind,line:item.loc.line});}
  if(!defs.has("main"))throw Error("Missing fn main()");
  let recursionDepth=0;
  const traits=new Map([["Display",new Set(["&str","char","u32","i32","usize","f64","bool"])]]);
  function instantiate(name,argTypes){
    const fn=defs.get(name);if(!fn)throw Error("Unresolved function "+name);
    if(fn.params.length!==argTypes.length)throw Error(name+" expects "+fn.params.length+" argument(s)");
    const subst=new Map();
    for(let k=0;k<fn.params.length;k++){
      const expected=fn.params[k].type,actual=argTypes[k];
      const g=fn.generics.find(x=>x.name===expected);
      if(g){if(subst.has(g.name)&&subst.get(g.name)!==actual)throw Error("Conflicting generic inference for "+g.name);subst.set(g.name,actual);}
      else if(!compatible(expected,actual))throw Error("Type mismatch in "+name+": expected "+expected+", got "+actual);
    }
    for(const g of fn.generics){const actual=subst.get(g.name);if(!actual)throw Error("Cannot infer generic "+g.name+" in "+name);for(const bound of g.bounds){const ok=traits.get(bound)?.has(actual)||bound==="Copy"&&(!actual.startsWith("Vec<"));if(!ok)throw Error("Trait obligation failed: "+actual+": "+bound);obligations.push(actual+": "+bound);}}
    const key=name+"<"+fn.generics.map(g=>subst.get(g.name)).join(",")+">";
    if(instances.has(key))return {key,returnType:subst.get(fn.returnType)||fn.returnType};
    if(++recursionDepth>80)throw Error("Generic instantiation recursion limit exceeded");
    const entry={key,name,fn,typeArguments:Object.fromEntries(subst),returnType:subst.get(fn.returnType)||fn.returnType};
    instances.set(key,entry);
    const scopes=[new Map(fn.params.map((p,i)=>[p.name,{type:argTypes[i],mutable:false,initialized:true}]))];
    const get=n=>{for(let j=scopes.length-1;j>=0;j--)if(scopes[j].has(n))return scopes[j].get(n);throw Error("Unresolved identifier "+n);};
    function infer(n){
      if(!n)return "()";
      if(n.kind==="literal")return n.type;
      if(n.kind==="variable")return get(n.name).type;
      if(n.kind==="array"){const types=n.items.map(infer);if(types.some(x=>x!==types[0]))throw Error("Array elements must share a type");return "["+(types[0]||"unknown")+";"+types.length+"]";}
      if(n.kind==="index"){const t=infer(n.object),i=infer(n.index);if(!isNumber(i))throw Error("Index must be integer");const m=/^\[(.+);\d+\]$/.exec(t);if(!m)throw Error("Indexing non-array "+t);return m[1];}
      if(n.kind==="field"){const t=infer(n.object),s=structs.get(t);if(!s)throw Error("Unknown field base "+t);const f=s.fields.find(x=>x.name===n.field);if(!f)throw Error("Unknown field "+n.field);return f.type;}
      if(n.kind==="unary"){const t=infer(n.value);if(n.op==="!") {if(t!=="bool")throw Error("Logical not requires bool");return "bool";}if(n.op==="-"){if(!isNumber(t))throw Error("Negation requires numeric type");return t;}if(n.op==="&")return "&"+(n.mutable?"mut ":"")+t;if(n.op==="*"){if(!t.startsWith("&"))throw Error("Cannot dereference "+t);return t.replace(/^&(?:mut )?/,"");}}
      if(n.kind==="binary"){const a=infer(n.left),b=infer(n.right);if(!compatible(a,b))throw Error("Invalid operands: "+a+" "+n.op+" "+b);if(["&&","||"].includes(n.op)){if(a!=="bool")throw Error("Boolean operator requires bool");return "bool";}if(["==","!=","<",">","<=",">="].includes(n.op))return "bool";if(!isNumber(a))throw Error("Arithmetic requires numeric operands, got "+a);return a;}
      if(n.kind==="ifExpr"){if(infer(n.condition)!=="bool")throw Error("if condition must be bool");const a=checkBlock(n.then);const b=n.otherwise?checkBlock(n.otherwise):"()";if(!compatible(a,b))throw Error("Incompatible if branch types "+a+" and "+b);return a;}
      if(n.kind==="call"){if(n.macro){if(!["println","print","format"].includes(n.callee.name))throw Error("Unsupported macro "+n.callee.name);if(n.args[0]?.kind!=="literal"||n.args[0].type!=="&str")throw Error("Formatting requires a string literal");const count=(n.args[0].value.match(/\{\}/g)||[]).length;if(count!==n.args.length-1)throw Error("Format argument count mismatch");n.args.slice(1).forEach(infer);return n.callee.name==="format"?"&str":"()";}
        const name=n.callee.name;
        if(name==="clone"){if(n.args.length!==1)throw Error("clone expects one argument");return infer(n.args[0]);}
        const result=instantiate(name,n.args.map(infer));n.resolved=result.key;return result.returnType;
      }
      throw Error("Unhandled expression "+n.kind);
    }
    function checkBlock(block){scopes.push(new Map());for(const stmt of block.body){
      if(stmt.kind==="let"){if(scopes.at(-1).has(stmt.name))throw Error("Duplicate binding "+stmt.name);const actual=infer(stmt.value);if(stmt.annotation&&!compatible(stmt.annotation,actual))throw Error("Binding "+stmt.name+" expects "+stmt.annotation+", got "+actual);scopes.at(-1).set(stmt.name,{type:stmt.annotation||actual,mutable:stmt.mutable,initialized:true});}
      else if(stmt.kind==="assign"){if(stmt.target.kind!=="variable")throw Error("Only variable assignments are supported");const slot=get(stmt.target.name);if(!slot.mutable)throw Error("Cannot assign to immutable variable "+stmt.target.name);const actual=infer(stmt.value);if(!compatible(slot.type,actual))throw Error("Assignment expects "+slot.type+", got "+actual);}
      else if(stmt.kind==="return"){const actual=infer(stmt.value);if(!compatible(entry.returnType,actual))throw Error("Return expected "+entry.returnType+", got "+actual);}
      else if(stmt.kind==="expression")infer(stmt.value);
      else if(stmt.kind==="while"||stmt.kind==="if"){if(infer(stmt.condition)!=="bool")throw Error(stmt.kind+" condition must be bool");checkBlock(stmt.then);if(stmt.otherwise)checkBlock(stmt.otherwise);}
      else if(stmt.kind==="loop"||stmt.kind==="blockStatement")checkBlock(stmt.then||stmt.block);
    }const type=block.tail?infer(block.tail):"()";scopes.pop();return type;}
    const actualReturn=checkBlock(fn.body);
    if(fn.body.tail&&!compatible(entry.returnType,actualReturn))throw Error("Function "+name+" returns "+actualReturn+", expected "+entry.returnType);
    recursionDepth--;return {key,returnType:entry.returnType};
  }
  instantiate("main",[]);
  return {instances:[...instances.values()],obligations,symbols,structures:[...structs.values()]};
}
export function lowerMir(sem){
  return sem.instances.map(instance=>{
    let id=0;const blocks=[];const fresh=()=>({id:"bb"+id++,statements:[],terminator:null});
    let current=fresh();blocks.push(current);
    function append(block){for(const statement of block.body){
      if(statement.kind==="if"){const yes=fresh(),no=fresh(),merge=fresh();current.terminator={kind:"switch",condition:statement.condition,true:yes.id,false:no.id};blocks.push(yes,no,merge);current=yes;append(statement.then);if(!current.terminator)current.terminator={kind:"goto",target:merge.id};current=no;if(statement.otherwise)append(statement.otherwise);if(!current.terminator)current.terminator={kind:"goto",target:merge.id};current=merge;}
      else if(statement.kind==="while"){const test=fresh(),yes=fresh(),done=fresh();current.terminator={kind:"goto",target:test.id};blocks.push(test,yes,done);test.terminator={kind:"switch",condition:statement.condition,true:yes.id,false:done.id};current=yes;append(statement.then);if(!current.terminator)current.terminator={kind:"goto",target:test.id};current=done;}
      else if(statement.kind==="return"){current.terminator={kind:"return",value:statement.value};current=fresh();blocks.push(current);}
      else current.statements.push(statement);
    }}
    append(instance.fn.body);if(!current.terminator)current.terminator={kind:"return",value:instance.fn.body.tail};
    return {instance:instance.key,blocks};
  });
}
export function emitJS(sem){
  const entries=new Map(sem.instances.map((x,i)=>[x.key,"ferrite_fn_"+i]));
  function expr(n){if(!n)return "undefined";
    switch(n.kind){
      case "literal":return JSON.stringify(n.value);
      case "variable":return n.name;
      case "array":return "["+n.items.map(expr).join(",")+"]";
      case "index":return "("+expr(n.object)+")["+expr(n.index)+"]";
      case "field":return "("+expr(n.object)+")["+JSON.stringify(n.field)+"]";
      case "binary":return "("+expr(n.left)+" "+n.op+" "+expr(n.right)+")";
      case "unary":return n.op==="&"?"("+expr(n.value)+")":"("+n.op+expr(n.value)+")";
      case "ifExpr":return "("+expr(n.condition)+" ? "+blockExpr(n.then)+" : "+(n.otherwise?blockExpr(n.otherwise):"undefined")+")";
      case "call":{
        if(n.macro){const args=n.args.map(expr);const formatted="__fmt("+args[0]+",["+args.slice(1).join(",")+"])";return n.callee.name==="format"?formatted:"__output.push("+formatted+(n.callee.name==="println"?"+'\\n'":"")+")";}
        if(n.callee.name==="clone")return expr(n.args[0]);const target=entries.get(n.resolved);if(!target)throw Error("Missing codegen instance "+n.resolved);return target+"("+n.args.map(expr).join(",")+")";
      }
    }throw Error("Codegen unsupported "+n.kind);}
  function stmt(n){
    switch(n.kind){
      case "let":return (n.mutable?"let ":"const ")+n.name+" = "+expr(n.value)+";";
      case "assign":return expr(n.target)+" "+n.op+" "+expr(n.value)+";";
      case "return":return "return "+expr(n.value)+";";
      case "expression":return expr(n.value)+";";
      case "if":return "if("+expr(n.condition)+")"+block(n.then)+(n.otherwise?"else "+block(n.otherwise):"");
      case "while":return "while("+expr(n.condition)+")"+block(n.then);
      case "loop":return "while(true)"+block(n.then);
      case "break":return "break;";
      case "continue":return "continue;";
      case "blockStatement":return block(n.block);
    }throw Error("Codegen unsupported statement "+n.kind);}
  function block(n){return "{\n"+n.body.map(stmt).join("\n")+"\n"+(n.tail?"return "+expr(n.tail)+";":"")+"}\n";}
  function blockExpr(n){return "(()=>"+block(n)+")()";}
  const out=['"use strict";','const __output=[];','function __fmt(s,args){let i=0;return s.replace(/\\{\\}/g,()=>String(args[i++]));}'];
  for(const i of sem.instances)out.push("function "+entries.get(i.key)+"("+i.fn.params.map(p=>p.name).join(",")+") /* "+i.key+" */ "+block(i.fn.body));
  out.push(entries.get("main<>")+"();","postMessage(__output.join(''));");
  return out.join("\n");
}
export function compile(source,{now=()=>performance.now()}={}){
  const timings=[];function pass(name,fn){const t=now(),result=fn();timings.push({name,ms:now()-t});return result;}
  const tokens=pass("Lex",()=>tokenize(source));
  const ast=pass("Parse",()=>parse(tokens));
  const sem=pass("Analyze",()=>analyze(ast));
  const mir=pass("Lower MIR",()=>lowerMir(sem));
  const js=pass("Emit JS",()=>emitJS(sem));
  return {tokens,ast,sem:{instances:sem.instances.map(x=>({key:x.key,name:x.name,typeArguments:x.typeArguments,returnType:x.returnType})),symbols:sem.symbols,obligations:sem.obligations,structures:sem.structures},mir,js,timings};
}
