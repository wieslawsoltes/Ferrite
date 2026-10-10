import {TypeSystem as T} from './TypeSystem.js';
import {Diagnostic} from './Diagnostic.js';

/** Checked, bounded owned-data operations shared by every execution backend. */
export function inferDataMethod(analyzer, node, ctx, original, base, expected) {
  const receiver=node.callee.object, method=node.callee.field;
  const string=['String','&str'].includes(base), vector=T.application(base), floating=['f32','f64'].includes(base);
  const methods=new Set(['parse','into_bytes','as_str','trim','starts_with','contains','to_lowercase','to_ascii_uppercase','is_empty','is_finite','abs','floor','round','remove']);
  if(!methods.has(method) && !(method==='push'&&base==='String'))return null;
  const fail=message=>{throw new Diagnostic('E0599',message,node.span);};
  const args=node.callee.typeArguments??[];
  if(method!=='parse'&&args.length)throw new Diagnostic('E0107',`${method} has no type parameters`,node.span);
  const count=['starts_with','contains','remove','push'].includes(method)?1:0;
  if(node.args.length!==count)throw new Diagnostic('E0061',`${method} expects ${count} argument(s)`,node.span);
  node.receiver=receiver;node.receiverDeref=base!==original;node.builtin=`method::${method}`;
  if(method==='parse'&&string){
    const hint=T.application(expected??'');
    if(args.length>1)throw new Diagnostic('E0107','parse expects one type argument',node.span);
    const target=args.length?analyzer.normalize(args[0],ctx,node):hint.name==='Result'?hint.args[0]:null;
    if(!target)throw new Diagnostic('E0282','Specify the numeric parse target, for example parse::<f64>()',node.span);
    if(!T.numeric(target))fail(`Numeric parsing does not implement FromStr for ${target}`);
    node.format={type:target};return `Result<${target},std::num::${T.integer(target)?'ParseIntError':'ParseFloatError'}>`;
  }
  if(method==='into_bytes'&&base==='String'){if(T.reference(original))throw new Diagnostic('E0507','Cannot move a String out of a borrowed receiver',receiver.span);return 'Vec<u8>';}
  if(method==='as_str'&&base==='String'||method==='trim'&&string)return '&str';
  if(['to_lowercase','to_ascii_uppercase'].includes(method)&&string)return 'String';
  if(['starts_with','contains'].includes(method)&&string){T.unify('&str',analyzer.infer(node.args[0],ctx,'&str'),new Map(),node);return 'bool';}
  if(method==='is_empty'&&(string||vector.name==='Vec'))return 'bool';
  if(method==='is_finite'&&floating)return 'bool';
  if(['abs','floor','round'].includes(method)&&floating)return base;
  if(method==='remove'&&vector.name==='Vec'||method==='push'&&base==='String'){
    if(T.reference(original)&&!original.startsWith('&mut '))throw new Diagnostic('E0596','Cannot mutate through a shared reference',receiver.span);
    if(!original.startsWith('&mut '))analyzer.place(receiver,ctx,true);
    T.unify(method==='remove'?'usize':'char',analyzer.infer(node.args[0],ctx,method==='remove'?'usize':'char'),new Map(),node);
    return method==='remove'?vector.args[0]:'()';
  }
  fail(`No supported method '${method}' for ${base}`);
}
