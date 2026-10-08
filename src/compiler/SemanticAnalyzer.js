const isNumber=t=>["u32","i32","f64","usize"].includes(t);
function compatible(expected,actual){return expected===actual||expected==="unknown"||actual==="unknown";}
export class SemanticAnalyzer {
 static analyze(ast){
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
      if(n.kind==="ifExpr"){if(infer(n.condition)!=="bool")throw Error("if condition must be bool");const a=checkBlock(n.then);const b=n.otherwise?(n.otherwise.kind==="ifExpr"?infer(n.otherwise):checkBlock(n.otherwise)):"()";if(!compatible(a,b))throw Error("Incompatible if branch types "+a+" and "+b);return a;}
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
      else if(stmt.kind==="while"||stmt.kind==="if"){if(infer(stmt.condition)!=="bool")throw Error(stmt.kind+" condition must be bool");checkBlock(stmt.then);if(stmt.otherwise){if(stmt.otherwise.kind==="ifExpr")infer(stmt.otherwise);else checkBlock(stmt.otherwise);}}
      else if(stmt.kind==="loop"||stmt.kind==="blockStatement")checkBlock(stmt.then||stmt.block);
    }const type=block.tail?infer(block.tail):"()";scopes.pop();return type;}
    const actualReturn=checkBlock(fn.body);
    if(fn.body.tail&&!compatible(entry.returnType,actualReturn))throw Error("Function "+name+" returns "+actualReturn+", expected "+entry.returnType);
    recursionDepth--;return {key,returnType:entry.returnType};
  }
  instantiate("main",[]);
  return {instances:[...instances.values()],obligations,symbols,structures:[...structs.values()]};
}
}
