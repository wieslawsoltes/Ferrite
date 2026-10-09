import {compile} from '../engine.js';
import {Lexer} from '../compiler/Lexer.js';
import {Diagnostic} from '../compiler/Diagnostic.js';
import {TypeSystem as T} from '../compiler/TypeSystem.js';
import {MirVerifier} from '../compiler/MirVerifier.js';
import {JavaScriptEmitter} from '../compiler/JavaScriptEmitter.js';
import {WebAssemblyEmitter} from '../compiler/wasm/WebAssemblyEmitter.js';
import {ViewSyntax} from './ViewSyntax.js';
import {UI_ABI_VERSION, UI_ABI_FILE, UI_INTRINSICS, UI_DECLARATIONS} from './RustAbi.js';

const callbackArguments = {component: [0], on_click: [1], on: [2], effect: [0, 1], memo: [0], update: [1]};
const retainedCallbacks = new Set(['component', 'on_click', 'on', 'effect']);
const scalar = type => T.numeric(type) || ['String', '&str', 'bool', 'char', '()'].includes(type);

/** Typed Rust -> verified MIR -> checked UI imports, with original-source spans. */
export class UICompiler {
  static compile(source, {file = 'src/ui.rs', entry = 'app', optimize = true, maxSteps = 250000, ...options} = {}) {
    if (file === UI_ABI_FILE || typeof file !== 'string' || !/^[\w./ -]+\.rs$/.test(file)) throw new Diagnostic('F_UI_FILE', 'A normal .rs source filename is required');
    if (!/^[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*$/.test(entry)) throw new Diagnostic('F_UI_ENTRY', 'Invalid UI entry name');
    const syntax = new ViewSyntax(source, {file}), expansion = syntax.expand();
    const tokens = Lexer.tokenize(expansion.source, {file});
    for (const token of tokens) {
      const span = expansion.mapSpan(token.span);
      Object.assign(token, {span, offset: span.start, end: span.end, file, line: span.line, column: span.column});
    }
    // The declaration provenance is not user-controllable and survives all passes.
    const declarations = Lexer.tokenize(UI_DECLARATIONS, {file: UI_ABI_FILE});
    const build = compile(expansion.source, {...options, entry, optimize, file, tokens: [...tokens.slice(0, -1), ...declarations]});
    const entryFunction = build.optimizedMir.find(fn => fn.instance === build.entry);
    if (entryFunction?.returnType !== 'ui::Node') throw new Diagnostic('F_UI_ENTRY', 'A UI entry must return ui::Node and take no arguments', entryFunction?.span);
    const shapes = new Map(build.sem.structures.map(shape => [shape.name, shape]));
    const closures = new Map(build.sem.closures.map(closure => [closure.type, closure]));
    const unsafeCapture = (type, seen = new Set()) => {
      if (type === 'ui::Node') return 'a render-local ui::Node';
      if (T.reference(type) && type !== '&str') return 'a borrowed reference';
      if (seen.has(type)) return null; seen.add(type);
      if (type.startsWith('(')) { for (const part of T.split(type.slice(1, -1))) { const bad = unsafeCapture(part, seen); if (bad) return bad; } }
      const array = /^\[(.+);\d+\]$/.exec(type);
      if (array) return unsafeCapture(array[1], seen);
      const application = T.application(type), shape = shapes.get(application.name);
      if (shape) {
        const substitutions = new Map((shape.generics ?? []).map((g, i) => [g.name, application.args[i]]));
        for (const field of shape.fields) { const bad = unsafeCapture(T.substitute(field.type, substitutions), seen); if (bad) return bad; }
      }
      for (const argument of application.args) { const bad = unsafeCapture(argument, seen); if (bad) return bad; }
      return null;
    };
    const link = functions => {
      const result = structuredClone(functions), byName = new Map(result.map(fn => [fn.instance, fn]));
      for (const fn of result) for (const block of fn.blocks) for (const instruction of block.instructions) {
        if (instruction.op !== 'call') continue;
        const target = byName.get(instruction.callee);
        if (target?.span?.file !== UI_ABI_FILE) continue;
        const match = /^ui::([a-z_]+)</.exec(target.instance), name = match?.[1];
        if (!UI_INTRINSICS.includes(name)) throw new Diagnostic('F_UI_ABI', 'Unknown compiler UI declaration', instruction.span);
        const types = instruction.args.map(slot => fn.registers[slot].type), callbacks = {};
        if (name === 'child' && !(scalar(types[0]) || ['ui::Node', 'Vec<ui::Node>', 'Option<ui::Node>'].includes(types[0])))
          throw new Diagnostic('F_UI_CHILD', `Unsupported child type ${types[0]}; use ui::Node, Vec<ui::Node>, Option<ui::Node>, or a displayable scalar`, instruction.span);
        for (const index of callbackArguments[name] ?? []) {
          const closure = closures.get(types[index]);
          if (!closure || closure.trait !== 'Fn' || !closure.instance) throw new Diagnostic('F_UI_CALLBACK', 'UI callbacks must be reusable, typed Fn closures', instruction.span);
          if (retainedCallbacks.has(name)) for (const capture of closure.captures) {
            const bad = capture.mode !== 'move' ? 'a borrowed capture' : unsafeCapture(capture.type);
            if (bad) throw new Diagnostic('F_UI_LIFETIME', `Retained UI callback captures ${bad} (${capture.name}); use owned move captures and state/ref handles`, closure.span);
          }
          callbacks[index] = {instance: closure.instance, type: closure.type, params: closure.params, span: closure.span};
        }
        instruction.op = 'builtin'; instruction.name = 'ferrite.ui.v1';
        instruction.format = {version: UI_ABI_VERSION, name, types, callbacks}; delete instruction.callee;
      }
      MirVerifier.verify(result); return result;
    };
    const mir = link(build.mir), optimizedMir = link(build.optimizedMir);
    const emitted = new JavaScriptEmitter(optimizedMir, {entry: null, library: true, runtime: {maxSteps}}).build();
    const wasm = new WebAssemblyEmitter(optimizedMir, {entry: build.entry}).build();
    return {format: 'ferrite-ui-v1', abi: UI_ABI_VERSION, file, source, entry: build.entry, optimize, maxSteps,
      nodes: expansion.nodes, mappings: expansion.mappings, expandedSource: expansion.source, mir, optimizedMir,
      js: emitted.code, generatedMap: emitted.sourceMap, wasm: {bytes: Array.from(wasm.bytes), metadata: wasm.metadata},
      diagnostics: build.diagnostics, timings: build.timings, closures: build.sem.closures, verification: MirVerifier.verify(optimizedMir)};
  }
}
