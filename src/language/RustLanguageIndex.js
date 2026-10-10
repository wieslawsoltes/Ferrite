import {RustDocument} from './RustDocument.js';
import {RustSignatures} from './RustSignatures.js';

const contains = (span, file, offset) => span?.file === file && span.start <= offset && offset <= span.end;
const lowerBound = (items, start) => { let lo = 0, hi = items.length; while (lo < hi) { const mid = (lo + hi) >>> 1; if (items[mid].start < start) lo = mid + 1; else hi = mid; } return lo; };

/** Resolved identity comes ONLY from typed HIR, selected against original-source tokens.
 * Generated UI temporaries and synthetic closure-environment accesses cannot produce
 * broad rename ranges. Capture fields are mapped using the compiler's capture table.
 */
export class RustLanguageIndex {
  constructor(build, files, documents = new Map()) {
    this.documents = documents; this.symbols = []; this.occurrences = []; this.declarations = new Map(); this.signatures = [];
    const names = new Map();
    for (const [file, text] of Object.entries(files)) {
      if (!file.endsWith('.rs')) continue;
      const document = documents.get(file)?.text === text ? documents.get(file) : new RustDocument(text, file); documents.set(file, document);
      const table = new Map();
      for (const token of document.tokens) if (token.identifier) { const list = table.get(token.name) ?? []; list.push(token); table.set(token.name, list); }
      names.set(file, table); this.signatures.push(...RustSignatures.read(document));
    }
    const tokenName = (span, name, exact = false) => {
      const list = names.get(span?.file)?.get(name); if (!list) return null;
      const token = list[lowerBound(list, span.start)];
      if (!token || token.end > span.end || exact && (token.start !== span.start || token.end !== span.end)) return null;
      return documents.get(span.file).span(token);
    };
    const add = (item) => { this.declarations.set(item.key, item.definition); this.occurrences.push(item); };
    for (const symbol of build.sem?.symbols ?? []) {
      const name = symbol.name.split('::').at(-1), selection = tokenName(symbol.span, name);
      if (!selection) continue;
      const key = 'symbol:' + symbol.name, signature = this.signatures.find(s => s.selection.file === selection.file && s.selection.start === selection.start);
      if (signature) signature.qualifiedName = symbol.name;
      this.symbols.push({...symbol, qualifiedName:symbol.name, name, selection, key, signature});
      add({key, name, span:selection, definition:selection, type:symbol.kind, declaration:true});
    }
    const instances = new Map((build.sem?.instances ?? []).map(item => [item.key, item]));
    const closures = new Map((build.sem?.closures ?? []).map(item => [item.instance, item]));
    const bindingItem = (binding, span, scope, declaration = false) => {
      const definition = tokenName(binding.span, binding.name);
      if (!definition || !/^\s*(?:(?:ref|mut)\s+)*$/.test(files[definition.file].slice(binding.span.start, definition.start))) return;
      const selection = declaration ? definition : tokenName(span, binding.name, true);
      if (!selection) return;
      add({key:`binding:${definition.file}:${definition.start}`, name:binding.name, span:selection, definition, scope, type:binding.type, declaration, parameter:!!binding.parameter});
    };
    for (const instance of instances.values()) for (const binding of instance.locals ?? []) bindingItem(binding, binding.span, instance.span, true);
    for (const hir of build.hir ?? []) {
      const seen = new WeakSet(), capture = closures.get(hir.instance);
      const visit = (node, scope) => {
        if (!node || typeof node !== 'object' || seen.has(node)) return; seen.add(node);
        if (node.kind === 'block' && files[node.span?.file]?.[node.span.start] === '{') scope = node.span;
        if (node.binding?.span && (node.kind === 'variable' || node.kind === 'bindingPattern')) bindingItem(node.binding, node.kind === 'bindingPattern' ? node.binding.span : node.span, scope, node.kind === 'bindingPattern');
        if (node.kind === 'field' && node.object?.binding?.name === '__environment' && /^_capture\d+$/.test(node.field)) {
          const binding = capture?.captures[Number(node.field.slice(8))];
          if (binding) bindingItem(binding, node.span, capture.span);
        }
        if (node.kind === 'call' && typeof node.resolved === 'string' && node.callee?.span) {
          const target = instances.get(node.resolved), key = 'symbol:' + (target?.name ?? node.resolved.split('<')[0]), definition = this.declarations.get(key);
          if (definition) {
            const span = node.callee.span, name = (node.callee.name ?? target?.name ?? '').split('::').at(-1), selection = tokenName(span, name);
            if (selection) add({key, name, span:selection, definition, type:target?.returnType ?? node.type});
            else {
              // Component calls are synthetic Rust, but their markup names are real source.
              const document = documents.get(span.file), element = document?.elements.find(e => !e.closing && e.start === span.start && e.tag.split('::').at(-1) === name);
              if (element) {
                add({key, name, span:document.source.span(element.tagStart, element.tagEnd), definition, type:target?.returnType ?? node.type});
                if (element.complete && element.closeNameStart !== undefined) add({key, name, span:document.source.span(element.closeNameStart, element.closeNameEnd), definition, type:target?.returnType ?? node.type});
              }
            }
          }
        }
        for (const [key, child] of Object.entries(node)) if (!['span','loc','binding'].includes(key)) {
          if (Array.isArray(child)) for (const item of child) visit(item, scope); else if (child && typeof child === 'object') visit(child, scope);
        }
      };
      visit(hir.body, instances.get(hir.instance)?.span ?? hir.span);
    }
    // Prefer the narrowest actual block scope for each local declaration.
    const scopes = new Map();
    for (const item of this.occurrences) if (item.declaration && item.scope) {
      const old = scopes.get(item.key); if (!old || item.scope.end - item.scope.start < old.end - old.start) scopes.set(item.key, item.scope);
    }
    const unique = new Map();
    for (const item of this.occurrences) {
      const key = `${item.key}:${item.span.file}:${item.span.start}:${item.span.end}`, old = unique.get(key);
      unique.set(key, {...item, declaration:!!(old?.declaration || item.declaration), scope:scopes.get(item.key) ?? item.scope});
    }
    this.occurrences = [...unique.values()];
  }
  at(file, offset) { return this.occurrences.filter(item => item.span.file === file && item.span.start <= offset && offset < item.span.end).sort((a,b) => a.span.end - a.span.start - (b.span.end - b.span.start))[0] ?? null; }
  candidates(file, offset) {
    const entries = this.symbols.filter(item => item.span.file === file).map(item => ({label:item.name, kind:item.kind === 'fn' ? 3 : 7, detail:item.signature?.label ?? `${item.kind} ${item.name}`, component:item.kind === 'fn' && /->\s*ui::Node\b/.test(item.signature?.label ?? '')}));
    const bindings = this.occurrences.filter(item => item.declaration && item.key.startsWith('binding:') && item.span.start <= offset && contains(item.scope, file, offset)).sort((a,b) => a.definition.start - b.definition.start);
    for (const item of bindings) entries.push({label:item.name, kind:item.parameter ? 5 : 6, detail:`${item.name}: ${item.type} · resolved binding`});
    return [...new Map(entries.map(item => [item.label,item])).values()];
  }
  /** In incomplete code, offer explicitly lexical candidates, NEVER identity/refactor data. */
  static syntaxCandidates(document, offset) {
    const tokens = document.tokens.filter(t => t.context === 'rust' && !['whitespace','comment'].includes(t.kind)), stack = [{end:document.text.length, names:[]}], entries = [];
    for (let i = 0; i < tokens.length && tokens[i].start < offset; i++) {
      const token = tokens[i];
      if (token.value === '{') stack.push({names:[]});
      else if (token.value === '}' && stack.length > 1) stack.pop();
      else if (token.value === 'let') {
        const name = tokens[i + (tokens[i + 1]?.value === 'mut' ? 2 : 1)];
        if (name?.identifier && name.start < offset) stack.at(-1).names.push({label:name.name, kind:6, detail:'Local syntax candidate · type analysis pending'});
      }
    }
    for (const signature of RustSignatures.read(document)) entries.push({label:signature.name, kind:3, detail:signature.label + ' · syntax candidate', component:/->\s*ui::Node\b/.test(signature.label)});
    for (const scope of stack) entries.push(...scope.names);
    return [...new Map(entries.map(item => [item.label,item])).values()];
  }
}
