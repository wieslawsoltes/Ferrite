/**
 * Content-addressed, bounded compiler queries. Keys retain exact source and
 * declaration environments: a hash collision can never reuse a typed result.
 * Declaration signatures invalidate callers; callee bodies invalidate callees.
 */
export class SemanticQueryCache {
  constructor({maxEntries = 512, maxCharacters = 12_000_000} = {}) {
    this.entries = new Map(); this.maxEntries = maxEntries; this.maxCharacters = maxCharacters;
    this.characters = 0; this.beginBuild();
  }
  beginBuild() { this.report = {hits: 0, misses: 0, nodes: []}; }
  clear() { this.entries.clear(); this.characters = 0; this.beginBuild(); }
  static environment(index) {
    const signature = fn => ({name: fn.name, module: fn.module, owner: fn.owner, visibility: fn.visibility,
      generics: fn.generics, params: fn.params.map(p => ({name: p.name, type: p.type, mutable: p.mutable})),
      returnType: fn.returnType, async: !!fn.async, attributes: fn.attributes, implementedTrait: fn.implementedTrait});
    const map = value => [...value].sort(([a], [b]) => a.localeCompare(b));
    return JSON.stringify({functions: map(index.functions).map(([name, fn]) => [name, signature(fn)]),
      structs: map(index.structs), enums: map(index.enums), constants: map(index.constants),
      traits: map(index.traits), imports: map(index.imports), moduleRoots: map(index.moduleRoots),
      moduleVisibility: map(index.moduleVisibility),
      impls: index.impls.map(impl => ({...impl, methods: impl.methods?.map(signature)}))});
  }
  lookup(stage, key, {id, span, dependencies = []} = {}) {
    const identity = stage + '\0' + key, entry = this.entries.get(identity);
    const hit = entry !== undefined;
    this.report[hit ? 'hits' : 'misses']++;
    const node = {id: `${stage}:${id}`, stage, span, cacheHit: hit, dependencies};
    this.report.nodes.push(node);
    if (hit) { this.entries.delete(identity); this.entries.set(identity, entry); }
    return {value: entry?.value, node, identity};
  }
  store(query, value) {
    // Callers own the stored result, and readers receive a clone. Cached HIR is
    // never shared with mutable lowering or code-generation passes.
    const snapshot = structuredClone(value);
    const cost = query.identity.length + JSON.stringify(snapshot).length;
    if (cost > this.maxCharacters) return;
    const old = this.entries.get(query.identity); if (old) this.characters -= old.cost;
    this.entries.delete(query.identity); this.entries.set(query.identity, {value: snapshot, cost}); this.characters += cost;
    while (this.entries.size > this.maxEntries || this.characters > this.maxCharacters) {
      const first = this.entries.keys().next().value; this.characters -= this.entries.get(first).cost; this.entries.delete(first);
    }
  }
  run(stage, key, metadata, action) {
    const query = this.lookup(stage, key, metadata);
    if (query.value !== undefined) return structuredClone(query.value);
    const value = action(); this.store(query, value); return value;
  }
  snapshot() { return {...structuredClone(this.report), entries: this.entries.size, characters: this.characters}; }
}
