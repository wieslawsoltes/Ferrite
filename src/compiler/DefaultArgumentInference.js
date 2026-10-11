import {Diagnostic} from './Diagnostic.js';
import {ImplTypePattern as Pattern} from './ImplTypePattern.js';
import {TypeSystem as T} from './TypeSystem.js';

/** Default arguments in an explicit partial constructor application are type
 * identities, not independent inference holes. Use alpha-renamed structural
 * variables with an occurs check; a concrete type called T cannot be confused
 * with the declaration's parameter T. Projected defaults only flow forward.
 * No state is shared with another constructor, declaration or compilation. */
export class DefaultArgumentInference {
  constructor(index, declaration, supplied, hint, node, module = null) {
    this.index = index; this.declaration = declaration; this.node = node;
    this.generics = declaration.generics; this.parameters = new Set(this.generics.map(g => g.name));
    this.defaults = []; this.visits = 0;
    if (supplied.length) index.genericDefaults.checkArity(declaration, supplied, node);
    this.mapping = new Map(this.generics.map((g, i) => {
      const explicit = supplied[i], expected = hint[i];
      if (explicit && explicit !== '_' && expected && expected !== '_') T.unify(expected, explicit, new Map(), node);
      const value = explicit && explicit !== '_' ? explicit : expected;
      return [g.name, value && value !== '_' ? value : null];
    }));
    if (supplied.length) for (let i = supplied.length; i < this.generics.length; i++) {
      const type=index.genericDefaults.formal(declaration,i);
      if(module!==null)index.genericDefaults.accessible(type,module,node,new Set(this.generics.slice(0,i).map(g=>g.name)));
      this.defaults.push({name:this.generics[i].name,type});
    }
    this.complete();
  }
  dependent(type) {
    if (!this.defaults.length || !this.index.associatedTypes.symbolic(type, this.parameters)) return false;
    return this.defaults.some(default_ => {
      const involved = new Set([default_.name, ...this.parameters].filter(name => default_.name === name ||
        T.substitute(default_.type, new Map([[name, '_']])) !== default_.type));
      return [...involved].some(name => this.mapping.get(name) === null && T.substitute(type, new Map([[name, '_']])) !== type);
    });
  }
  complete() {
    if (!this.defaults.length) return;
    if (++this.visits > 4096) throw new Diagnostic('F_GENERIC_DEFAULT_LIMIT', 'Default argument inference budget exceeded', this.node?.span);
    const bindings = new Map(), prefix = 'default:', variable = name => ({variable: prefix + name});
    const equal = (left, right) => {
      if (!Pattern.unify(left, right, bindings))
        throw new Diagnostic('E0308', `Type arguments do not satisfy the defaults of ${this.declaration.name}`, this.node?.span);
    };
    for (const [name, type] of this.mapping) if (type !== null)
      equal(variable(name), Pattern.parse(type, new Set(), `actual:${name}:`));
    for (const constraint of this.defaults) {
      if (this.index.associatedTypes.containsProjection(constraint.type)) {
        const actual = this.index.typeResolver.substitute(constraint.type, this.mapping, this.declaration);
        // Never reverse-infer a projection input from an associated output.
        if (this.index.associatedTypes.containsProjection(actual)) continue;
        equal(variable(constraint.name), Pattern.parse(actual, new Set(), `projection:${constraint.name}:`));
      } else equal(variable(constraint.name), Pattern.parse(constraint.type, this.parameters, prefix));
    }
    // Atomic publication: failed unification cannot partially mutate inference.
    const changes = [];
    for (const [name] of this.mapping) {
      const type = Pattern.render(variable(name), bindings);
      if (type !== null) changes.push([name, type]);
    }
    for (const [name, type] of changes) this.mapping.set(name, type);
  }
}
