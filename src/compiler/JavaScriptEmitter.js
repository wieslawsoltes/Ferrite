export class JavaScriptEmitter {
 static emit(sem){
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
      case "ifExpr":return "("+expr(n.condition)+" ? "+blockExpr(n.then)+" : "+(n.otherwise?(n.otherwise.kind==="ifExpr"?expr(n.otherwise):blockExpr(n.otherwise)):"undefined")+")";
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
      case "if":return "if("+expr(n.condition)+")"+block(n.then)+(n.otherwise?"else "+(n.otherwise.kind==="ifExpr"?expr(n.otherwise)+";":block(n.otherwise)):"");
      case "while":return "while("+expr(n.condition)+")"+block(n.then);
      case "for":return "for(let "+n.name+"="+expr(n.from)+";"+n.name+(n.inclusive?"<=":"<")+expr(n.to)+";"+n.name+"++)"+block(n.then);
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
}
