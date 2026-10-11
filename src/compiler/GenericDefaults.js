import {Diagnostic} from './Diagnostic.js';
import {TypeSystem as T} from './TypeSystem.js';
import {ImplObligations} from './ImplObligations.js';

/** Declaration-scoped default arguments. Supplied arguments are already resolved
 * in the caller's namespace; templates are resolved in the declaration's namespace
 * before one simultaneous substitution. Constructor inference relations are
 * owned separately by DefaultArgumentInference, never by the type resolver.
 * In particular `_` never means "use the default" and a constructor path without
 * a turbofish leaves every parameter available for ordinary inference. */
export class GenericDefaults {
  constructor(index, {maxDepth = 64, maxQueries = 100000, maxCharacters = 1000000} = {}) {
    for (const value of [maxDepth, maxQueries, maxCharacters])
      if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Generic default limits must be nonnegative safe integers');
    this.enabled = [...index.structs?.values() ?? [], ...index.enums?.values() ?? [], ...index.aliases?.values() ?? [], ...index.traits?.values() ?? []]
      .some(declaration => declaration.generics?.some(generic => generic.defaultType !== undefined));
    this.index = index; this.metadata = new WeakMap(); this.active = new Set();
    this.maxDepth = maxDepth; this.maxQueries = maxQueries; this.maxCharacters = maxCharacters;
    this.queries = 0; this.expanded = 0; this.templateQueries = 0;
  }
  info(declaration) {
    let info = this.metadata.get(declaration);
    if (!info) {
      const generics = declaration.generics ?? [];
      const first = generics.findIndex(g => g.defaultType !== undefined);
      info = Object.freeze({generics, required: first < 0 ? generics.length : first, hasDefaults: first >= 0});
      this.metadata.set(declaration, info);
    }
    return info;
  }
  has(declaration) { return this.info(declaration).hasDefaults; }
  checkArity(declaration, supplied, node = declaration) {
    const {generics, required} = this.info(declaration);
    if (supplied.length < required || supplied.length > generics.length)
      throw new Diagnostic('E0107', `${declaration.name} expects ${required === generics.length ? required : `${required} to ${generics.length}`} type argument(s), got ${supplied.length}`, node?.span ?? declaration.span);
  }
  expand(declaration, supplied, {node = declaration, parameters = new Set(), self = null, module = null} = {}) {
    this.checkArity(declaration, supplied, node);
    const {generics} = this.info(declaration);
    if (supplied.length === generics.length) return supplied;
    if (++this.queries > this.maxQueries || this.active.size >= this.maxDepth)
      throw new Diagnostic('F_GENERIC_DEFAULT_LIMIT', 'Generic default expansion budget exceeded', node?.span ?? declaration.span);
    const result = supplied.slice();
    const mapping = new Map(generics.slice(0, result.length).map((g, i) => [g.name, result[i]]));
    if (declaration.kind === 'trait') mapping.set('Self', self ?? 'Self');
    for (let i = result.length; i < generics.length; i++) {
      const generic = generics[i];
      {
        const formal = this.formal(declaration,i);
        if (module !== null) this.accessible(formal,module,node,new Set([...generics.slice(0,i).map(g=>g.name), 'Self']));
        for (const [parameter, actual] of mapping) if (/\b_\b/.test(actual) && T.substitute(formal,new Map([[parameter,'__FerriteDefaultHole']])) !== formal)
          throw new Diagnostic('F_GENERIC_DEFAULT_INFERENCE', 'A dependent default in a type path needs a concrete earlier argument; constructor applications use their own inference equations', node?.span ?? generic.defaultSpan);
        const actual = this.index.typeResolver.substitute(formal, mapping, node, parameters);
        if (actual.length > this.maxCharacters)
          throw new Diagnostic('F_GENERIC_DEFAULT_LIMIT', 'Expanded generic default exceeds the type size budget', node?.span ?? generic.defaultSpan);
        result.push(actual); mapping.set(generic.name, actual); this.expanded++;
      }
    }
    return result;
  }
  formal(declaration, i) {
    const generics = declaration.generics, generic = generics[i];
    this.templateQueries++;
    if (++this.queries > this.maxQueries) throw new Diagnostic('F_GENERIC_DEFAULT_LIMIT', 'Generic default query budget exceeded', generic.defaultSpan);
    const parameters = new Set(generics.slice(0,i).map(g=>g.name));
    if (declaration.kind === 'trait') parameters.add('Self');
    if (this.active.has(generic)) throw new Diagnostic('E0391', `Recursive generic default for ${declaration.name}::${generic.name}`, generic.defaultSpan);
    if (this.active.size >= this.maxDepth) throw new Diagnostic('F_GENERIC_DEFAULT_LIMIT', 'Generic default template nesting budget exceeded', generic.defaultSpan);
    this.active.add(generic);
    // Guard template expansion, not normalization of a substituted caller type.
    // The latter can legitimately need this template while elaborating its own
    // declaration-local predicates; associated projection guards own that work.
    try {
      return this.index.type(generic.defaultType,declaration.module ?? '',declaration.kind === 'trait' ? 'Self' : null,
        parameters,{...generic,span:generic.defaultSpan ?? declaration.span,typeContext:declaration});
    } finally { this.active.delete(generic); }
  }
  /** Even an unused default is a type declaration, not unchecked expression text. */
  validateSyntax() {
    for (const declaration of [...this.index.structs.values(), ...this.index.enums.values(), ...this.index.aliases.values(), ...this.index.traits.values()]) {
      const {generics} = this.info(declaration);
      for (const [i, generic] of generics.entries()) {
        if (generic.defaultType === undefined) continue;
        const node = {span: generic.defaultSpan ?? declaration.span};
        if (/\b_\b/.test(generic.defaultType)) throw new Diagnostic('E0121', 'A default type cannot contain inference placeholders', node.span);
        if (/\bimpl\s/.test(generic.defaultType)) throw new Diagnostic('E0562', 'A default type cannot contain impl Trait', node.span);
        for (const later of generics.slice(i)) if (T.substitute(generic.defaultType, new Map([[later.name, '__FerriteLaterDefaultParameter']]), true) !== generic.defaultType)
          throw new Diagnostic('E0128', `Default for ${generic.name} cannot reference itself or later parameter ${later.name}`, node.span);
        if (declaration.kind !== 'trait' && T.substitute(generic.defaultType, new Map([['Self', '__FerriteDefaultSelf']]), true) !== generic.defaultType)
          throw new Diagnostic('E0735', 'Self is not available in this generic default', node.span);
      }
    }
  }
  validateDefinitions(analyzer) {
    for (const declaration of [...this.index.structs.values(), ...this.index.enums.values(), ...this.index.aliases.values(), ...this.index.traits.values()]) {
      const {generics, required, hasDefaults} = this.info(declaration);
      if (!hasDefaults) continue;
      const parameters = new Set(generics.map(g => g.name));
      if (declaration.kind === 'trait') parameters.add('Self');
      // Default well-formedness does not assume that a preceding symbolic
      // parameter satisfies the later parameter's bound. Rust checks concrete
      // failures here and the full substituted obligations at each use.
      const identity = declaration.name + (generics.length ? `<${generics.map(g => g.name).join(',')}>` : '');
      const self = declaration.kind === 'trait' ? 'Self' : null;
      const context = declaration.kind === 'trait' ? {...declaration, kind: 'genericDefaultContext', traitContext: declaration.name, unsizedSelf: true,
        generics: [{name:'Self',bounds:[identity]}, ...generics]} : declaration;
      for (let i = required; i < generics.length; i++) {
        const generic = generics[i], node = {...declaration, span: generic.defaultSpan ?? declaration.span};
        // The default's abbreviated T::Item path is not resolved by generic
        // bounds in Rust's default-parameter scope; use a qualified projection.
        const qualified = new Map(generics.slice(0,i).map(g=>[g.name, '__FerriteDefaultParameter']));
        if (/__FerriteDefaultParameter::/.test(T.substitute(generic.defaultType,qualified,true)))
          throw new Diagnostic('E0220', 'Use a qualified associated-type projection in a default parameter', node.span);
        // Each default is checked once with preceding binders symbolic, not
        // by repeatedly expanding its whole suffix or applying prior defaults.
        const type = this.formal(declaration,i);
        this.index.typeResolver.validateKnown(type, parameters, node);
        if (this.index.associatedTypes.symbolic(type, parameters)) continue;
        const environment = new ImplObligations(analyzer,{target:self,impl:context},context);
        environment.validateCanonical(type,node);
        environment.requireSized(type,node);
        // Free alias parameter bounds are not enforced by Rust, including defaults.
        if (declaration.kind === 'typeAlias') continue;
        const mapping = new Map([[generic.name,type]]);
        const required = generic.bounds.map(bound=>[generic.name,bound]);
        for (const predicate of declaration.predicates ?? []) for (const bound of predicate.bounds) required.push([predicate.type,bound]);
        for (const [subject,raw] of required) {
          const actual = this.index.instantiatedType(subject,context,mapping,node,parameters);
          const syntax = this.index.instantiatedType(raw,context,mapping,node,parameters);
          const bound = environment.trait(syntax,declaration.module,node,actual);
          if (!environment.symbolic(actual) && !environment.symbolic(bound) && !environment.prove(actual,bound))
            throw new Diagnostic('E0277', `Default ${actual} does not satisfy ${bound}`, node.span);
        }
      }
    }
  }
  /** Check names introduced by a default at its use, never re-resolve caller
   * arguments in the default's namespace. Symbolic inputs remain opaque here. */
  accessible(type, module, node, parameters = new Set(), depth = 0) {
    if (depth > 128) throw new Diagnostic('F_GENERIC_DEFAULT_LIMIT', 'Default visibility type depth exceeded', node?.span);
    if (parameters.has(type)) return;
    const next = value => this.accessible(value,module,node,parameters,depth+1);
    if (T.reference(type)) return next(T.target(type));
    const fn=T.function(type); if(fn){[...fn.params,fn.result].forEach(next);return;}
    const tuple=T.tuple(type),array=T.array(type); if(tuple||array){(tuple??[array.element]).forEach(next);return;}
    const projection=T.projection(type);if(projection){next(projection.self);next(projection.trait);return;}
    const app=T.traitApplication(type);
    const declaration=this.index.structs.get(app.name)??this.index.enums.get(app.name)??this.index.traits.get(app.name);
    if(declaration&&!parameters.has(app.name))this.index.visible(declaration,module,node);
    [...app.args,...T.bindingTypes(app.bindings)].forEach(next);
  }
  snapshot() { return {queries: this.queries, expandedArguments: this.expanded, templateQueries: this.templateQueries, activeExpansions: this.active.size}; }
}
