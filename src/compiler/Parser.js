export class Parser {
 static parse(tokens) {
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
      if(peek()==="for"){const t=take(),name=take().value;eat("in");const from=expr();const inclusive=peek()==="..=";if(peek()!==".."&&peek()!=="..=")throw Error("Expected range .. or ..= after for iterator");take();const to=expr(),then=block();body.push(node("for",{name,from,to,inclusive,then},t));continue;}
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
    else if(peek()==="match"){
      take();const value=expr();eat("{");const arms=[];
      while(peek()!=="}"){
        const patternToken=tokens[i];let pattern;
        if(peek()==="_"){take();pattern={kind:"wildcard",loc:{line:patternToken.line,column:patternToken.column,offset:patternToken.offset}};}
        else{pattern=expr(7);if(pattern.kind!=="literal")throw Error("Only literal and wildcard match patterns are supported");}
        eat("=>");const body=peek()==="{"?block():expr();arms.push({pattern,body,loc:{line:patternToken.line,column:patternToken.column,offset:patternToken.offset}});
        if(peek()===",")take();else if(peek()!=="}")throw Error("Expected ',' after match arm");
      }
      eat("}");left=node("match",{value,arms},start);
    }
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
      if(peek()==="{"&&left.kind==="variable"&&/^[A-Za-z_]\\w*$/.test(peek(1))&&peek(2)===":"){
        take();const fields=[];
        while(peek()!=="}"){const field=take().value;eat(":");fields.push({name:field,value:expr()});if(peek()!==",")break;take();}
        eat("}");left=node("structLiteral",{name:left.name,fields},start);continue;
      }
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

}
