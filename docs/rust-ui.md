# Rust UI Studio

Rust UI Studio is an optional Ferrite tool window, an independent component runtime,
a typed `view!` compiler frontend, a source-backed designer, a live event debugger,
a shared MCP tool family, and an embeddable JavaScript compiler SDK. It works without
a native bridge. The existing default project and terminal remain unchanged.

## Compatibility contract

**This is not rustc in JavaScript and is not a complete React implementation.** UI
expressions and callbacks use Ferrite's documented Rust subset and its conservative
ownership checker. They are not rewritten into JavaScript expressions. Installed
Cargo is a separate, opt-in native backend. The [standard-Rust UI workspace](native-rust-ui.md)
now provides a real `view!` proc macro, Rust-owned hooks and a checked browser Wasm host.
It uses installed rustc and target-compatible dependencies, not the JavaScript compiler.

The JavaScript runtime implements its own public component/hook APIs. It does not
load React, use React private internals, or make existing React elements interchangeable
with Ferrite elements. The JSX import adapters are for **source-level migration of
function components**, not binary compatibility or automatic JavaScript-to-Rust translation.

## Open the designer

Run the ordinary IDE, select **Rust UI Studio** in the right tool region or tool rail,
then select **+ counter**, **+ form**, or **+ components**. Each creates a new source
file without overwriting an existing example. Select a backend and press **Preview**.
On a narrow display the tool rail opens the Studio as a floating window.

The ordinary editor and Studio's Rust source editor edit the same workspace file.
**Pick element** selects a rendered element and its original source range. The outline
also selects text/expression nodes. The property editor supports literal/expression/
boolean attributes, tag and text changes, insertion, duplication and deletion. Drag an
outline item onto a destination to reparent it. Operations edit original UTF-16 ranges;
unrelated comments, whitespace, and Rust code are preserved. The full candidate source
is type-checked before a visual edit is committed. Invalid edits leave the file unchanged.

Source edits invalidate the previous preview. Press Preview to compile the new source.
Compiler diagnostics retain original source locations. Responsive, phone and tablet
preview widths are available. The CSS editor persists preview/export styling in a workspace `.ui.css` file.
A `.ui.json` sidecar retains the entry, backend, viewport and grid settings. Canvas
move/resize modes commit snapped absolute geometry into literal source styles. Dynamic
style expressions are not silently rewritten; this is not a general CSS layout solver.
Multi-file component picking selects the original module while compilation retains
the project entry point. See [compatibility workflows](ui-compatibility.md).

`SourceDesigner` is usable independently. Its node IDs are **source-offset IDs valid
only for the inspected revision**, not permanent entity IDs. Every mutation, undo and
redo requires the expected revision. Structural operations reject cycles, overlapping
ranges and foreign insertion anchors. History is bounded to 50 transactions and four
million source units. Studio uses the workspace's own revision/checkpoint history.

```js
import {SourceDesigner} from './src/sdk/Ferrite.js';
const source = 'fn app() -> ui::Node { view! { <h1>Hello</h1> } }';
const design = new SourceDesigner(source);
const heading = design.nodes.find(node => node.tag === 'h1');
const changed = design.apply({
  op: 'setAttribute', node: heading.id, name: 'className',
  kind: 'string', value: 'title'
}, design.revision);
console.log(changed.source);
design.undo(changed.revision);
```

## Write a Rust component

The root entry defaults to `app`: a zero-argument function returning `ui::Node`.
`view!` supports HTML/SVG tags, fragments, text, quoted Rust strings, boolean
attributes, and `{Rust expressions}`. Children can be `ui::Node`, `Vec<ui::Node>`,
`Option<ui::Node>`, or supported scalar values. Use Rust control flow to produce them.

```rust
fn app() -> ui::Node {
    let count = ui::use_state(0);
    view! {
        <section className="card">
            <h1>Rust counter</h1>
            <output>{ui::get(count)}</output>
            <button on:click={move || ui::update(count, |previous| previous + 1)}>
                Increase
            </button>
        </section>
    }
}
```

Component tags start with an uppercase letter and take an explicit typed `props`
expression. Each keyed component retains its own hook state. See
`src/ui-framework/Samples.js` for the checked `CardProps`/`Card` example. Implicit
JSX spread attributes, JavaScript expressions, and implicit component-children props
are not part of this Rust macro grammar.

### Rust host API

| Area | Implemented calls |
| --- | --- |
| Nodes | `element`, `fragment`, `text`, `value`, `child`, `attr`, `key`, `component` |
| Integer state | `use_state(i64)`, `get`, `set`, functional `update` |
| String state | `use_string(&str)`, `get_string`, `set_string` |
| Boolean state | `use_bool`, `get_bool`, `set_bool` |
| Events | `on_click`, `on` with a `String` event value, synchronous `prevent_default` |
| DOM refs | `use_ref`, `node_ref`, `focus`, `ref_value` |
| Effects | `effect(setup, cleanup, dependencies: &str)` |
| Memo | `memo(factory -> i64, dependencies: &str)` |

The macro lowers `on:click={move || ...}` to a typed no-argument callback and other
`on:event={move |value: String| ...}` attributes to typed value callbacks. `ref={ref}`
connects a DOM ref. Effects execute after commit and retain a separate cleanup closure.
The string dependency token is compared as a string, not parsed as a JavaScript array.

Retained component/event/effect callbacks must be reusable `Fn` closures with owned
`move` captures. Borrowed references and render-local node handles cannot cross the
asynchronous DOM lifetime, including when nested in aggregates. State/ref handles
can be copied into closures. The checked host boundary rejects stale handles and state
type mismatches. These rules are intentionally stricter than full Rust lifetime analysis.
Generic `state`, `read`, `write`, `modify`, `memo_value`, `memo_with` and `effect_with`
now support owned values described by the browser compiler's type schemas, including
records, enums, tuples, arrays and vectors. Borrowed/reference-carrying or unsupported
values remain rejected. Native Cargo hooks keep arbitrary `Clone + 'static` values
in Rust, without crossing the JSON state boundary. The JavaScript runtime's hooks
can hold ordinary JavaScript values. `on_event` supplies owned keyboard, input, pointer,
modifier and wheel fields; `stop_propagation` controls the current synchronous event.

### Compilation and execution

`ViewSyntax` scans Rust comments and literals, parses bounded markup, emits Rust and
maps its tokens to original source spans. The ordinary compiler performs type/ownership
analysis, monomorphization and MIR verification. The UI linker rewrites calls **only**
to compiler-owned declarations originating in reserved `ferrite:ui-abi`; similarly
named user functions cannot become host intrinsics. Unlinked declaration bodies trap.
The linked MIR is verified again before backend emission.

All three backends run actual Rust callbacks and share the DOM host ABI:

| Backend | Execution |
| --- | --- |
| `javascript` | Generated JavaScript functions from verified MIR; default |
| `wasm` | Actual WebAssembly exports with a checked externref host ABI |
| `mir` | Register-MIR VM; instruction/source state and execution trace |

Wasm is not WASI, a native executable, LLVM output, or DOM access without JavaScript.
Compilation emits all three representations. Each session owns its state, refs, retained
closures and transient handles. Unmount releases subscriptions, effects, DOM refs,
portals and host handles. Failed mounts dispose partial state and report the failure.

UI source is limited to 512,000 UTF-16 units, markup nesting to 128, and parsed nodes
to 10,000. Callback instruction budgets default to 250,000, configurable between 1
and 2,000,000. Callback nesting is capped at 64; transient/persistent handles default
to a 50,000 live budget. These are resource limits, not a proof that arbitrary compiler
inputs cannot consume time. The IDE and MCP compile in cancellable workers; direct
SDK compilation is synchronous unless the embedding application supplies its own worker.

## Embed the compiler or run Rust scripts

The ESM entry is `src/sdk/Ferrite.js`, with `compileRust`, `runRust`, `compileUI`,
`mountUI`, `exportHTML`, `SourceDesigner`, `UICompiler`, `UISession`, `UI` and
`createUIRuntime`. Package self-imports use `ferrite-compiler`. The repository remains
private-to-publishing (`package.json` has `private: true`); no npm release is implied.

```js
import {compileUI, mountUI, runRust, exportHTML} from './src/sdk/Ferrite.js';
const source = `fn app() -> ui::Node {
    let n = ui::use_state(0);
    view! { <button on:click={move || ui::update(n, |v| v + 1)}>{ui::get(n)}</button> }
}`;
const artifact = compileUI(source, {file: 'src/app.ui.rs'});
const session = mountUI(artifact, document.getElementById('app'), {backend: 'wasm'});
console.log(runRust('fn main() -> i64 { 6 * 7 }', {backend: 'javascript'}).value); // 42n
const html = exportHTML(artifact, {backend: 'wasm', title: 'My Rust app'});
// Persist html as an application file. When removing this application:
session.dispose();
```

For a classic `<script>` without a module import graph, use the generated
**`src/sdk/ferrite.bundle.js`**. It installs `globalThis.Ferrite`. Its deterministic
closed module graph contains the compiler and runtime; it has no external module,
CDN, Node bridge or package dependency. `examples/ui-embed.html` is executable:

```html
<div id="counter"></div>
<script src="./src/sdk/ferrite.bundle.js"></script>
<script type="text/rust" data-target="counter" data-entry="app" data-backend="javascript">
fn app() -> ui::Node {
    let n = ui::use_state(0);
    view! { <button on:click={move || ui::update(n, |v| v + 1)}>{ui::get(n)}</button> }
}
</script>
<script>
  const mounted = Ferrite.runScripts();
  // Repeated calls skip successfully executed script elements.
  // mounted[0].result.dispose() releases this UI session.
</script>
```

`runScripts` is **explicit**, inline-only and once-per-successful-script-element.
`application/rust` is also recognized. Without `data-target`, a script executes its
Rust `main` entry and returns its value/output. Failed scripts are retryable after
repair; `onError(error, script)` permits collecting failures without aborting the scan.
A `src` attribute on a Rust script is rejected rather than implicitly fetched.

Compiled artifacts contain executable code. Do not accept arbitrary serialized
artifacts from untrusted callers in a privileged page. The direct SDK runs in the
embedding JavaScript realm; it is not a replacement for the IDE's iframe sandbox.
Do not combine independent `createUIRuntime()` hook dispatchers inside one component
tree; pass the same runtime consistently to the session or root.

## Migrate React-style function components

Public ESM adapters are `ferrite-compiler/react`, `ferrite-compiler/react-dom/client`,
`ferrite-compiler/react-dom`, `ferrite-compiler/jsx-runtime` and
`ferrite-compiler/jsx-dev-runtime`. They share **one** dispatcher. TypeScript's automatic
JSX mode uses `jsxImportSource: "ferrite-compiler"`; classic JSX can use
`React.createElement` or `h`. Strict declaration fixtures cover props, refs, memoized
components, context, typed state setters and compiler/backend options.

```tsx
import {useState} from 'ferrite-compiler/react';
import {createRoot} from 'ferrite-compiler/react-dom/client';
function Counter({initial}: {initial: number}) {
  const [count, setCount] = useState(initial);
  return <button onClick={() => setCount(n => n + 1)}>{count}</button>;
}
createRoot(document.getElementById('app')!).render(<Counter initial={0}/>);
```

Port imports first, test event/ref/effect behavior, then optionally rewrite individual
components in Rust. The runtime includes keyed fragments/components and DOM reuse,
state/reducer/ref/memo/callback/effect/layoutEffect/context/id/imperativeHandle/
external-store hooks, `memo`, `forwardRef`, lazy components, promise/context `use`,
Suspense, functional error boundaries, portals, `cloneElement` and `Children` helpers.
Conditional `use(context)` does not consume an ordinary hook slot.

Important differences remain: synchronous reconciliation, no concurrent scheduler,
transitions, server components, class-component lifecycles or React DevTools protocol.
First-party SSR and strict DOM hydration are now implemented. The optional actual-React
adapter delegates concurrent rendering, ecosystem components and streaming to an
explicitly injected React installation rather than emulating React internals. Native DOM events are used rather than React SyntheticEvent.
Render-phase state updates are rejected. `Children` preserves primitive values and
empty-slot counting but does not reproduce React's nested key recomputation. Descriptor
call signatures in the type declarations support JSX; do not invoke symbolic/exotic
component descriptors directly. Third-party React components require migration and
conformance testing; aliasing imports alone is not evidence of compatibility.

## Debug the live UI

The inspector reads the actual component tree, props/hook summaries, Rust state
handles and commit timings. State editing uses checked handles. i64 values travel as
decimal strings, avoiding JSON's integer precision limit; out-of-range values fail.

**Arm events** pauses the next retained Rust event callback before execution.
**Instruction**, **Source line**, **Continue** and **Disarm** operate on its real MIR
VM, registers/call frames, trace and source breakpoints. This works even when ordinary
rendering uses JavaScript or Wasm: the armed event is executed by the equivalent MIR
interpreter. It is not native JavaScript/Wasm instruction stepping. Rendering and
effect callbacks remain synchronous. A paused event cannot call `prevent_default`
after the browser has already decided its default action; that operation reports an
explicit error. Unmount/disarm cancels queued events. Back instruction, Back source line
and Restart now restore bounded MIR snapshots and staged state, preserving reference
aliases. Continue commits the resulting DOM update. Host effects and a committed DOM
render establish irreversible boundaries; native Rust Wasm and external browser state
are not rewound. See the compatibility guide for the exact execution contract.

## MCP and coding-agent tools

The existing native and in-page agent registries share the same definitions. Additional
compatibility tools (`ui_project_inspect`, `ui_project_set`, `ui_render_html`,
`ui_native_preview`, `ui_native_export_html`) are documented in the compatibility and native guides:

| Tool | Authority and behavior |
| --- | --- |
| `ui_analyze` | Read; typed/source-mapped compilation and MIR verification |
| `ui_export_html` | Read; complete generated HTML, large output via artifact paging |
| `ui_design_inspect` | Read; exact ranges, node IDs and content hash |
| `ui_design_edit` | Edit approval; expected hash, typed atomic operation, checkpoint |
| `ui_preview` | Execute approval; compile/mount in the connected IDE |
| `ui_inspect` | Read; current live tree/state/debugger; rejects stale preview |
| `ui_debug` | Execute approval; arm/step/step-line/continue/stop |
| `ui_state_set` | Execute approval; checked live state mutation |

The IDE command bridge also recognizes `ui.preview`, `ui.inspect`, `ui.select`,
`ui.debug` and `ui.state.set`. Generic `ide_command` cannot downgrade UI execution to
read-only authority. Edits recheck hashes at application time; concurrent edits are
not overwritten. External native MCP requires a real connected IDE for live tools.
Compilation/export work without one. A preview command starts asynchronous mounting;
wait for readiness before inspecting. No fake browser session is returned.

## Export and isolation

**Export HTML** emits one actual application document: selected executable backend,
DOM runtime and required VM/Wasm host support are embedded. Reopening it does not
require Ferrite, a CDN, a server or the compiler. Source/title/CSS serialization escapes
HTML terminators. Network assets are not downloaded/inlined automatically; embed needed
assets as data URLs. The export CSP blocks connections and external resources.

Designer previews use `sandbox="allow-scripts"` **without** `allow-same-origin` and a
restrictive CSP. The parent checks the exact frame window, opaque origin, message type
and a rotating 192-bit capability. The bridge has bounded pending requests, timeouts,
abort and disposal behavior. Source reloads revoke old capabilities. No arbitrary eval
command is exposed. Runtime DOM APIs reject script/iframe/object/embed/base/meta/link
elements, string event handlers, raw HTML setters and executable URL schemes.
The document permits inline/generated code required by these backends; exporting is
not a claim of a universal hostile-JavaScript sandbox.

## Validation and reproduction

```sh
npm run build:workers
npm run build:sdk
npm run check
npm test
npm run test:ui
npm run test:ui:types     # TypeScript 5.8.3 used for the checked declaration fixtures
npm run test:ui:browser   # Python + pinned Playwright/Chromium, as in test.yml
```

The unit suite includes compiler/ABI source mapping, callback ownership rejection,
three-backend DOM state/effect parity, source-preserving/stale/invalid designer edits,
keyed reconciliation, ref/effect/portal cleanup, hook-order failures, sandbox-channel
validation, native/browser MCP approval/checkpoint conflicts, package JSX imports,
classic-script embedding, explicit script lifecycle and callback execution budgets.

The Chromium acceptance harness compiles in the IDE worker, picks an element, edits
source, exercises actual clicks/controlled inputs/refs, checks bidirectional editor
synchronization, steps an event, downloads and executes offline HTML on all three
backends, loads the classic SDK, and opens the mobile tool window. Evidence is under
`artifacts/ui-browser/`. Its normal mode tests HTTP IDE delivery and downloaded file
navigation. `FERRITE_MEMORY_TEST=1` uses the existing in-memory module harness for
restricted environments; it runs the DOM/compiler code but does **not** claim HTTP or
file delivery coverage. Chromium is the verified browser; Safari/Firefox parity has
not been measured here. Existing compiler/native Cargo/terminal/agent checks remain.

## Compatibility follow-through

The [compatibility guide](ui-compatibility.md) covers the implemented generic hooks,
structured events, multi-file designer, persisted styles, snapped canvas editing,
SSR/hydration, actual React adapter and reverse event debugger. The [native Rust guide](native-rust-ui.md)
provides Cargo build commands, ABI/lifetime contracts, native Studio import and standalone export.

The browser compiler is still not rustc, the first-party runtime is not a replacement
for every React API, and no automatic general JavaScript-to-Rust translator is supplied.
Reuse unmodified React components through the injected real-React adapter, then port
selected components explicitly. Native binaries expose DOM inspection and export,
not browser-compiler source editing, MIR stepping or native heap mutation. Safari/Firefox,
all crates.io packages and every React ecosystem package are not claimed as validated.
