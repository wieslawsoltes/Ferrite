/** MIR instruction formatting is independent from rendering and source navigation. */
export class IrFormatter {
  static register(slot){return `%${slot}`;}
  static instruction(i){const r=this.register,prefix=i.dest==null?'':`${r(i.dest)} = `,place=p=>`${r(p.slot)}${p.path.map(x=>x.kind==='deref'?'.*':x.kind==='field'?'.'+x.name:`[${r(x.register)}]`).join('')}`;
    let text;
    switch(i.op){
      case 'const':text=`const ${JSON.stringify(i.value)} : ${i.type}`;break;
      case 'read':text=`${i.copy?'copy':'read'} ${place(i.place)}`;break;
      case 'write':text=`${place(i.place)} ← ${r(i.value)}`;break;
      case 'copy':text=`${r(i.target)} ← ${r(i.value)}`;break;
      case 'borrow':text=`&${i.mutable?'mut ':''}${place(i.place)}`;break;
      case 'binary':text=`${r(i.left)} ${i.operator} ${r(i.right)}`;break;
      case 'unary':text=`${i.operator}${r(i.value)}`;break;
      case 'call':text=`call ${i.callee}(${i.args.map(r).join(', ')})`;break;
      case 'builtin':text=`${i.name}(${i.args.map(r).join(', ')})`;break;
      case 'cast':text=`${r(i.value)} as ${i.targetType}`;break;
      case 'aggregate':text=`${i.form}${i.tag?' '+i.tag:''} [${i.values.map(r).join(', ')}]`;break;
      case 'get':text=`${r(i.value)}${i.index!=null?'['+r(i.index)+']':'.'+i.field}`;break;
      case 'tag':text=`discriminant ${r(i.value)}`;break;
      case 'payload':text=`${r(i.value)}.payload[${i.index}]`;break;
      case 'repeat':text=`[${r(i.value)}; ${i.count}]`;break;
      default:text=i.op;
    }return prefix+text;
  }
  static terminator(t){if(t.kind==='return')return `return %${t.value}`;if(t.kind==='goto')return `goto ${t.target}`;if(t.kind==='unreachable')return 'unreachable';return `if %${t.condition} → ${t.true} / ${t.false}`;}
}
