import {compile} from '../engine.js';
import {Diagnostic} from '../compiler/Diagnostic.js';
import {TypeSystem as T} from '../compiler/TypeSystem.js';
import {MirVerifier} from '../compiler/MirVerifier.js';
import {JavaScriptEmitter} from '../compiler/JavaScriptEmitter.js';
import {WebAssemblyEmitter} from '../compiler/wasm/WebAssemblyEmitter.js';
import {prepareUIProject} from './UIProjectCompiler.js';
import {UI_ABI_VERSION, UI_ABI_FILE, UI_INTRINSICS} from './RustAbi.js';

const callbackArguments = {component: [0], on_click: [1], on: [2], effect: [0, 1], memo: [0], update: [1], modify: [1], memo_value: [0], memo_with: [0], effect_with: [0, 1], on_event: [2], interval: [1], state_with: [0]};
const retainedCallbacks = new Set(['component', 'on_click', 'on', 'effect', 'effect_with', 'on_event', 'interval']);
const scalar = type => T.numeric(type) || ['String', '&str', 'bool', 'char', '()'].includes(type);

/** Typed Rust -> verified MIR -> checked UI imports, with original-source spans. */
export class UICompiler {
  static compile(source, {file = 'src/ui.rs', entry = 'app', optimize = true, maxSteps = 250000, files = {}, entryProps = false, ...options} = {}) {
    if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 2_000_000) throw new Diagnostic('F_UI_BUDGET', 'UI instruction budget must be between 1 and 2,000,000');
    if (file === UI_ABI_FILE || typeof file !== 'string' || !/^[\w./ -]+\.rs$/.test(file)) throw new Diagnostic('F_UI_FILE', 'A normal .rs source filename is required');
    if (!/^[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*$/.test(entry)) throw new Diagnostic('F_UI_ENTRY', 'Invalid UI entry name');
    const project = prepareUIProject(source, {file, files, configuration: options.configuration}), expansion = project.expansion;
    if (typeof entryProps !== 'boolean') throw new Diagnostic('F_UI_ENTRY', 'entryProps must be boolean');
    const build = compile(expansion.source, {...options, entry, ...(entryProps ? {mode: 'library'} : {}), optimize, file, tokens: project.tokens, ast: project.ast});
    if (entryProps) build.entry = build.optimizedMir.find(fn => fn.instance === `${entry}<>`)?.instance;
    const entryFunction = build.optimizedMir.find(fn => fn.instance === build.entry);
    if (entryFunction?.returnType !== 'ui::Node' || entryFunction?.params?.length !== (entryProps ? 1 : 0)) throw new Diagnostic('F_UI_ENTRY', 'A UI entry must return ui::Node; entryProps permits exactly one owned argument', entryFunction?.span);
    const shapes = new Map(build.sem.structures.map(shape => [shape.name, shape]));
    const enums = new Map(build.sem.enums.map(shape => [shape.name, shape]));
    const ownedSchemas = Object.create(null);
    const schema = type => ownSchema(type, shapes, enums, ownedSchemas);
    const entryPropsType = entryProps ? schema(entryFunction.registers[entryFunction.params[0]].type) : null;
    const closures = new Map(build.sem.closures.map(closure => [closure.type, closure]));
    const unsafeCapture = (type, seen = new Set()) => {
      if (['ui::State', 'ui::Ref'].includes(type) || T.application(type).name === 'ui::Signal') return null;
      if (type === 'ui::Node') return 'a render-local ui::Node';
      if (T.reference(type) && type !== '&str') return 'a borrowed reference';
      if (seen.has(type)) return null; seen.add(type);
      if (type.startsWith('(')) { for (const part of T.split(type.slice(1, -1))) { const bad = unsafeCapture(part, seen); if (bad) return bad; } }
      const array = /^\[(.+);\d+\]$/.exec(type);
      if (array) return unsafeCapture(array[1], seen);
      const application = T.application(type), shape = shapes.get(application.name) ?? enums.get(application.name);
      if (shape) {
        const substitutions = new Map((shape.generics ?? []).map((g, i) => [g.name, application.args[i]]));
        for (const field of shape.fields ?? shape.variants.flatMap(v => v.fields.map(type => ({type})))) { const bad = unsafeCapture(T.substitute(field.type, substitutions), seen); if (bad) return bad; }
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
        const stateType = ['read', 'write', 'modify'].includes(name) ? T.application(types[0]).args[0] : name === 'state' ? types[0] : name === 'state_with' ? T.application(target.returnType).args[0] : null;
        const valueType = name === 'emit' ? types[1] : ['memo_value', 'memo_with'].includes(name) ? target.returnType : null;
        const dependencyType = name === 'memo_with' ? types[1] : name === 'effect_with' ? types[2] : null;
        for (const type of [stateType, valueType, dependencyType]) if (type) schema(type);
        instruction.op = 'builtin'; instruction.name = 'ferrite.ui.v1';
        instruction.format = {version: UI_ABI_VERSION, name, types, callbacks, stateType, valueType, dependencyType}; delete instruction.callee;
      }
      MirVerifier.verify(result); return result;
    };
    const mir = link(build.mir), optimizedMir = link(build.optimizedMir);
    const emitted = new JavaScriptEmitter(optimizedMir, {entry: null, library: true, runtime: {maxSteps}}).build();
    const wasm = new WebAssemblyEmitter(optimizedMir, {entry: build.entry}).build();
    return {format: 'ferrite-ui-v1', abi: UI_ABI_VERSION, file, source, entry: build.entry, optimize, maxSteps,
      files: project.files, modules: project.modules, ownedSchemas, entryPropsType, nodes: project.nodes, mappings: expansion.mappings, expandedSource: expansion.source, mir, optimizedMir,
      js: emitted.code, generatedMap: emitted.sourceMap, wasm: {bytes: Array.from(wasm.bytes), metadata: wasm.metadata},
      diagnostics: build.diagnostics, timings: build.timings, closures: build.sem.closures, verification: MirVerifier.verify(optimizedMir)};
  }
}

/** Produce recursive nominal schemas only for clonable owned data, never DOM/VM handles. */
function ownSchema(type, structures, enums, schemas, depth = 0) {
  if (Object.hasOwn(schemas, type)) return type;
  if (depth > 128 || Object.keys(schemas).length > 2048) throw new Diagnostic('F_UI_STATE_TYPE', 'Owned state schema budget exceeded');
  const reject = () => { throw new Diagnostic('F_UI_STATE_TYPE', `${type} is not supported owned UI data; references, closures and UI handles cannot be stored`); };
  const sub = type => ownSchema(type, structures, enums, schemas, depth + 1);
  let result;
  if (T.integer(type)) result = {kind: 'integer', bits: type.endsWith('size') ? 32 : Number(type.slice(1)), signed: type[0] === 'i'};
  else if (['f32', 'f64'].includes(type)) result = {kind: 'float', bits: Number(type.slice(1))};
  else if (['String', '&str'].includes(type)) result = {kind: 'string'};
  else if (type === 'bool' || type === 'char') result = {kind: type};
  else if (type === '()') result = {kind: 'unit'};
  else if (type.startsWith('(')) { schemas[type] = {kind: 'pending'}; const items = T.split(type.slice(1, -1)).map(sub); result = {kind: 'tuple', items, length: items.length}; }
  else {
    const array = /^\[(.+);(\d+)\]$/.exec(type), app = T.application(type);
    if (array) { schemas[type] = {kind: 'pending'}; result = {kind: 'sequence', item: sub(array[1]), length: Number(array[2])}; }
    else if (app.name === 'Vec' && app.args.length === 1) { schemas[type] = {kind: 'pending'}; result = {kind: 'sequence', item: sub(app.args[0])}; }
    else {
      if (type.startsWith('ui::') && type !== 'ui::Event') reject();
      const shape = structures.get(app.name) ?? enums.get(app.name); if (!shape) reject();
      schemas[type] = {kind: 'pending'};
      const substitutions = new Map((shape.generics ?? []).map((g, i) => [g.name, app.args[i]]));
      const resolve = t => sub(T.substitute(t, substitutions));
      result = shape.variants ? {kind: 'enum', variants: shape.variants.map(v => ({tag: `${app.name}::${v.name}`, fields: v.fields.map(resolve)}))} :
        {kind: 'record', fields: shape.fields.map(f => ({name: f.name, type: resolve(f.type)}))};
    }
  }
  schemas[type] = result; return type;
}
