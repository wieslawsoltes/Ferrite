import {UI_DECLARATIONS} from '../ui-framework/RustAbi.js';
import {RustDocument, RUST_KEYWORDS} from './RustDocument.js';
import {RustSignatures} from './RustSignatures.js';

const tags = 'a article aside audio b blockquote br button canvas caption circle code col colgroup datalist dd defs details dialog div dl dt ellipse em fieldset figcaption figure footer foreignObject form g h1 h2 h3 h4 h5 h6 header hr i img input label legend li line linearGradient main marker nav ol optgroup option output p path pattern picture polygon polyline pre progress radialGradient rect section select small source span strong style summary svg symbol table tbody td template text textarea th thead title tr tspan ul use video'.split(' ');
const common = 'id className class style title role tabIndex hidden key ref aria-label aria-labelledby aria-describedby aria-hidden aria-live aria-expanded aria-controls aria-selected aria-checked aria-disabled data-testid'.split(' ');
const attributes = {
  input:'type value checked disabled placeholder name required readOnly min max step multiple autoComplete',
  button:'type disabled name value', form:'action method', label:'htmlFor', textarea:'value placeholder rows cols disabled readOnly required name',
  select:'value multiple disabled required name', option:'value selected disabled', a:'href target rel download', img:'src alt width height loading',
  svg:'viewBox width height fill stroke xmlns', path:'d fill stroke strokeWidth', circle:'cx cy r fill stroke', rect:'x y width height rx fill stroke',
  output:'htmlFor name', progress:'value max', details:'open', dialog:'open', video:'src controls autoPlay muted loop', audio:'src controls autoPlay muted loop'
};
const events = 'click dblclick input change submit keydown keyup pointerdown pointerup pointermove pointerenter pointerleave pointercancel mousedown mouseup mousemove focus blur wheel contextmenu'.split(' ');
const docs = {
  use_state:'Create a stable i64 state handle. Read with ui::get; update using ui::set or ui::update.',
  state:'Create a typed owned signal. Use ui::read, ui::write and ui::modify with the same value type.',
  update:'Apply a reusable Fn(i64) -> i64 update to a state handle.',
  modify:'Transform a typed signal using a reusable Fn(T) -> T callback.',
  on_event:'Register an owned callback receiving a typed ui::Event.',
  effect:'Run setup after commit; run cleanup before replacement or unmount. Dependencies are explicit.',
  use_ref:'Create a stable DOM reference; assign it with ref={reference}.',
  className:'DOM class attribute (className is an alias for class).',
  htmlFor:'DOM label association (htmlFor is an alias for for).',
  key:'Stable sibling identity. Keys control keyed reconciliation; they are not ordinary DOM attributes.',
  ref:'Attach a ui::Ref created by ui::use_ref().',
  props:'Component argument supplied as a typed Rust expression. Components accept props and key, not DOM attributes.',
  'on:click':'Zero-argument reusable callback: on:click={move || ...}. Captures retained by the UI must be owned.',
  onClick:'Alias for on:click: a zero-argument reusable callback.'
};
const abi = new RustDocument(UI_DECLARATIONS, 'ferrite:ui-abi');
const signatures = new Map(RustSignatures.read(abi).map(item => [item.name, item]));
const types = [...new Set(abi.tokens.filter((token, index) => token.kind === 'type' && abi.tokens.slice(Math.max(0, index - 2), index).some(t => t.value === 'struct')).map(t => t.name))];

/** UI catalog signatures come from the compiler ABI; no separate copy can drift. */
export class UILanguageCatalog {
  static signatures = signatures;
  static signature(name) { return name.startsWith('ui::') ? signatures.get(name.slice(4)) : null; }
  static documentation(name) {
    if (name.startsWith('on_event:')) return `Typed event callback: ${name}={move |event: ui::Event| ...}. Event fields expose keyboard, pointer, form and wheel data.`;
    if (name.startsWith('on:')) return docs[name] ?? `DOM ${name.slice(3)} event; callback receives the String event value. Use on_event:${name.slice(3)} for a typed ui::Event.`;
    return docs[name] ?? (name.startsWith('aria-') ? 'ARIA accessibility attribute; its value is forwarded to the DOM.' : name.startsWith('data-') ? 'Custom data attribute forwarded to the DOM.' : 'DOM attribute forwarded by the Ferrite UI runtime.');
  }
  static context(document, offset) {
    const right = document.tokenAt(offset), left = document.tokenAt(offset, true);
    const token = right?.start < offset ? right : left;
    if (token && ['comment','string','char','text'].includes(token.kind) && (offset < token.end || token.incomplete || token.kind === 'comment' || token.kind === 'text')) return {kind:'none'};
    const element = document.elements.findLast(e => offset >= e.tagStart && offset <= e.openEnd && (!e.complete || offset < e.openEnd));
    if (element && offset <= element.tagEnd) return {kind:'tag', element, start:element.tagStart, end:element.tagEnd, prefix:document.text.slice(element.tagStart, offset)};
    if (element && offset > element.tagEnd && token?.context === 'markup') {
      const attribute = element.attributes.find(a => offset >= a.start && offset <= a.nameEnd);
      if (attribute) return {kind:'attribute', element, start:attribute.start, end:attribute.nameEnd, prefix:document.text.slice(attribute.start, offset)};
      if (token.kind === 'whitespace' || token.value === '>') return {kind:'attribute', element, start:offset, end:offset, prefix:''};
      return {kind:'none'};
    }
    if (token?.context === 'markup') return {kind:'none'};
    const ident = right?.identifier && right.start < offset ? right : left?.identifier && left.end === offset ? left : null;
    const start = ident?.start ?? offset, end = ident?.end ?? offset, prefix = document.text.slice(start, offset);
    const significant = document.tokens.filter(t => t.end <= start && t.context === 'rust' && !['whitespace','comment'].includes(t.kind));
    const ui = significant.at(-1)?.value === '::' && significant.at(-2)?.name === 'ui';
    return {kind: ui ? 'ui' : 'rust', start, end, prefix};
  }
  static completion(document, offset, candidates = [], uiEnabled = true) {
    const context = this.context(document, offset), {prefix = ''} = context, kind = context.kind === 'ui' && !uiEnabled ? 'rust' : context.kind;
    if (kind === 'none') return {isIncomplete:false, items:[]};
    const item = (label, detail, completionKind = 10) => ({label, detail, kind:completionKind}); let entries;
    if (kind === 'tag') {
      const closing = context.element.closing, expected = context.element.parent?.tag;
      entries = closing ? expected ? [item(expected, 'Matching closing tag')] : [] : [...tags.map(tag => item(tag, 'DOM element')), ...candidates.filter(c => c.component).map(c => item(c.label, c.detail, 7))];
    } else if (kind === 'attribute') {
      const element = context.element, component = /^[A-Z_]|::/.test(element.tag);
      const names = component ? ['props','key'] : [...common, ...(attributes[element.tag]?.split(' ') ?? []), 'onClick', ...events.flatMap(event => ['on:' + event, 'on_event:' + event])];
      const used = new Set(element.attributes.filter(a => a.start !== context.start).map(a => a.name));
      entries = [...new Set(names)].filter(name => !used.has(name)).map(name => item(name, this.documentation(name), name.startsWith('on') ? 23 : 10));
    } else if (kind === 'ui') {
      entries = [...signatures].map(([name, signature]) => item(name, signature.label, 3)).concat(types.map(name => item(name, 'Compiler UI ABI type', 7)));
    } else entries = [...candidates, ...[...RUST_KEYWORDS].map(name => item(name, 'Rust keyword', 14))];
    const point = at => { const p = document.source.position(at); return {line:p.line - 1, character:p.column - 1}; };
    const normalized = prefix.replace(/^r#/, '').normalize('NFC');
    return {isIncomplete: kind === 'rust', items: [...new Map(entries.filter(entry => entry.label.startsWith(normalized)).map(entry => [entry.label, entry])).values()].slice(0,300).map(entry => ({...entry,
      insertTextFormat:1, textEdit:{range:{start:point(context.start), end:point(context.end)}, newText:prefix.startsWith('r#') && !entry.label.startsWith('r#') ? 'r#' + entry.label : entry.label}}))};
  }
  static hover(document, offset) {
    const token = document.tokenAt(offset); if (!token) return null;
    let value;
    if (token.kind === 'tag') value = `<${token.value}>\nDOM element in view! markup.`;
    else if (token.kind === 'attribute' || token.kind === 'event') value = `${token.value}\n${this.documentation(token.value)}`;
    else if (token.kind === 'macro' && token.value === 'view') value = 'view! { <element attributes={Rust expressions}>children</element> }\nTyped Ferrite UI macro; Rust expressions are analyzed in their enclosing scope.';
    else if (token.identifier) {
      const context = this.context(document, token.end);
      if (context.kind === 'ui') {
        const signature = signatures.get(token.name);
        if (signature) value = signature.label + '\n' + (docs[token.name] ?? 'Compiler-owned Ferrite UI ABI function.');
        else if (types.includes(token.name)) value = `ui::${token.name}\nCompiler-owned UI ABI type.`;
      }
    }
    return value ? {value, span:document.span(token)} : null;
  }
  static signatureHelp(document, offset, candidates = [], uiEnabled = true) {
    const call = RustSignatures.callAt(document, offset); if (!call) return null;
    const builtin = uiEnabled ? this.signature(call.name) : null;
    const signature = builtin ?? candidates.find(item => item.qualifiedName === call.name || item.name === call.name);
    if (!signature) return null;
    return {signatures:[{label:signature.label, parameters:signature.parameters, documentation:{kind:'plaintext',value:builtin ? docs[call.name.split('::').at(-1)] ?? 'Compiler-owned Ferrite UI ABI function.' : 'Rust function signature from source.'}}], activeSignature:0, activeParameter:Math.min(call.activeParameter, Math.max(0, signature.parameters.length - 1))};
  }
}
