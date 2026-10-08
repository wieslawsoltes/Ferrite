import {Diagnostic} from './Diagnostic.js';

export class FunctionContext {
  constructor(instance) {
    this.instance = instance; this.scopes = [new Map()]; this.locals = []; this.loops = [];
  }
  push() { this.scopes.push(new Map()); }
  pop() { this.scopes.pop(); }
  declare(name, type, mutable, node, parameter = false) {
    const binding = {slot: this.locals.length, name, type, mutable, parameter, level: this.scopes.length - 1, span: node?.span};
    this.locals.push(binding); this.scopes.at(-1).set(name, binding);
    return binding;
  }
  lookup(name, node, required = true) {
    for (let i = this.scopes.length - 1; i >= 0; i--) if (this.scopes[i].has(name)) return this.scopes[i].get(name);
    if (required) throw new Diagnostic('E0425', `Unresolved identifier '${name}'`, node?.span);
    return null;
  }
}
