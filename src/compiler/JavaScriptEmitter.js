import {LiteralValue} from './LiteralValue.js';
import {Runtime} from '../runtime/Runtime.js';
import {MirLowerer} from './MirLowerer.js';
import {MirVerifier} from './MirVerifier.js';

/** Emits safe identifiers and a control-flow dispatcher from verified MIR. */
export class JavaScriptEmitter {
  constructor(functions, options = {}) {
    this.functions = functions; this.options = options; this.lines = []; this.map = [];
    this.names = new Map(functions.map((fn, index) => [fn.instance, `f${index}`]));
  }
  static emit(semantic, options = {}) {
    const functions = Array.isArray(semantic) ? semantic : MirLowerer.lower(semantic);
    return new JavaScriptEmitter(functions, {entry: semantic.entry ?? 'main<>', ...options}).build().code;
  }
  add(text, span = null, instruction = null) {
    if (span) this.map.push({line: this.lines.length + 1, span, instruction});
    this.lines.push(...text.split('\n'));
  }
  value(slot) { return `c[${slot}].value`; }
  json(value) { return JSON.stringify(value ?? null); }
  place(place) {
    const path = place.path.map(part => part.kind === 'index' ? `{kind:"index",value:${this.value(part.register)}}` : this.json(part));
    return `r.reference(c,${place.slot},[${path.join(',')}])`;
  }
  expression(i) {
    const v = slot => this.value(slot), j = value => this.json(value);
    switch (i.op) {
      case 'const': return `r.literal(${j(LiteralValue.encode(i.value))},${j(i.type)})`;
      case 'read': return `r.read(${this.place(i.place)},${!!i.copy})`;
      case 'borrow': return this.place(i.place);
      case 'binary': return `r.binary(${j(i.operator)},${v(i.left)},${v(i.right)},${j(i.operandType)})`;
      case 'unary': return `r.unary(${j(i.operator)},${v(i.value)},${j(i.type)})`;
      case 'discriminant': return `r.discriminant(${v(i.value)},${j(i.table)})`;
      case 'cast': return `r.cast(${v(i.value)},${j(i.targetType)})`;
      case 'aggregate': return `r.aggregate(${j(i.form)},[${i.values.map(v)}],${j(i.names ?? [])},${j(i.tag)})`;
      case 'repeat': return `Array.from({length:${i.count}},()=>r.clone(${v(i.value)}))`;
      case 'get': return `r.get(${v(i.value)},${i.index == null ? j(i.field) : v(i.index)},${i.index != null},${!!i.deref},${!!i.copy})`;
      case 'tag': return `${v(i.value)}.tag`;
      case 'payload': return `${v(i.value)}.values[${i.index}]`;
      case 'call': return `${this.names.get(i.callee)}(${i.args.map(v).join(',')})`;
      case 'builtin': return `r.builtin(${j(i.name)},[${i.args.map(v)}],{format:${j(i.format)},receiver:${i.receiverPlace ? this.place(i.receiverPlace) : i.receiver == null ? 'null' : v(i.receiver)},receiverReference:${!!i.receiverPlace},receiverDeref:${!!i.receiverDeref}})`;
      default: throw new Error(`Cannot emit instruction ${i.op}`);
    }
  }
  build() {
    MirVerifier.verify(this.functions);
    this.add('"use strict";');
    this.add(`const FerriteRuntime = ${Runtime.toString()};`);
    this.add(`const r = new FerriteRuntime(${this.json(this.options.runtime ?? {})});`);
    for (const fn of this.functions) {
      const name = this.names.get(fn.instance), args = fn.params.map((_, i) => `a${i}`);
      this.add(`function ${name}(${args.join(',')}) { // ${fn.instance}`, fn.span);
      this.add(`r.enter(); const c=r.cells(${fn.registers.length});`);
      fn.params.forEach((slot, i) => this.add(`${this.value(slot)}=a${i};`));
      this.add(`let block=${this.json(fn.entry)}; try { while(true) { switch(block) {`);
      for (const block of fn.blocks) {
        this.add(`case ${this.json(block.id)}: { // ${block.label}`, block.span);
        for (const i of block.instructions) {
          this.add(`r.tick(${this.json(i.span)});`, i.span, i.id);
          if (i.op === 'write') this.add(`r.write(${this.place(i.place)},${this.value(i.value)});`, i.span, i.id);
          else if (i.op === 'copy') this.add(`${this.value(i.target)}=${i.copy ? `r.clone(${this.value(i.value)})` : this.value(i.value)};`, i.span, i.id);
          else this.add(`${this.value(i.dest)}=${this.expression(i)};`, i.span, i.id);
        }
        const t = block.terminator;
        this.add(`r.tick(${this.json(t.span)});`, t.span);
        if (t.kind === 'return') this.add(`return ${this.value(t.value)};`, t.span);
        else if (t.kind === 'unreachable') this.add('r.fail("Entered an unreachable block");', t.span);
        else if (t.kind === 'goto') this.add(`block=${this.json(t.target)}; continue;`, t.span);
        else this.add(`block=${this.value(t.condition)}?${this.json(t.true)}:${this.json(t.false)}; continue;`, t.span);
        this.add('}');
      }
      this.add('default: r.fail("Invalid block"); } } } finally { r.leave(); } }');
    }
    const entry = Object.hasOwn(this.options, 'entry') ? this.options.entry : 'main<>';
    if (entry && this.names.has(entry)) this.add(`${this.names.get(entry)}();`);
    this.add('if (typeof postMessage === "function") postMessage(r.output);');
    return {code: this.lines.join('\n'), sourceMap: this.map};
  }
}
