# UI compatibility follow-through

This work follows the merged Rust UI Studio implementation in PR #7. Each capability must have executable tests, preserve the existing compiler/IDE/agent behavior, and describe its actual compatibility boundary.

## Delivered capability areas

- Owned generic Rust state and memo values, structured DOM events, and multi-file Rust UI compilation with original file spans.
- Persisted UI projects/styles and source-backed canvas position/size editing.
- Server rendering/hydration and explicit integration with the real React dispatcher for React ecosystem and concurrent-rendering support.
- Reversible deterministic Rust event debugging with bounded snapshots, without claiming reversal of external browser effects.
- A standard-toolchain Rust UI crate and browser Wasm host, with executable native/Wasm examples.
- Embeddable SDK, single-file export, shared MCP tools, examples and regression coverage for the added capabilities.

The three execution paths are deliberately distinct: the browser Rust-subset compiler,
the standard Cargo/rustc Wasm runtime, and an injected actual React installation.
None silently impersonates another. Details and reproduction commands follow.

## Real React integration

`createReactAdapter({React, ReactDOMClient, ReactDOM, ReactDOMServer})` uses an
explicitly injected React installation. It does not alias `react` to the independent
Ferrite runtime. Existing JavaScript/TypeScript React components keep their own public
React hooks, class lifecycles, context, portals, Suspense, concurrent transitions,
Activity and streaming server renderer. `adapter.createComponent(artifact)` embeds a
compiled Rust function component in that React tree; `adapter.mount` owns a root with
explicit disposal and public React Profiler observations.

Compile an entry taking one owned parameter with `{entryProps: true}` and pass it
through the component's `value` prop. Integer fields use BigInt or decimal strings;
JSON numbers are deliberately not silently narrowed. `ui::emit(name, value)` invokes
an explicit `onEvent(name, jsonValue)` receiver. Callback bindings are captured with
the render that produced the callback, so speculative concurrent props cannot leak
into the still-committed DOM. `ui::external(name, props_json, children)` resolves an
explicit `components` registry and creates an actual React component, not a copied
implementation. DOM refs on arbitrary ecosystem components still follow those
components' own contracts; the Rust component's ref exposes its inspection handle.

Rust signals use `useSyncExternalStore`: their writes remain synchronous, and React
may restart a transition as blocking when that store changes. This is not a claim of
non-blocking Rust signal updates or an independent concurrent Ferrite scheduler.
Hook ownership uses weak handles rather than effect-cleanup disposal, because Strict
Mode and Activity deliberately replay effects while retaining component state.
External React roots own their fibers and garbage collection; adapter-owned roots
add explicit deterministic session disposal. Server components/build systems remain
the responsibility of the injected React environment, not the Rust subset compiler.

Pinned compatibility tests use React/ReactDOM 19.2.0 and Radix Dialog 1.1.15. These are
reproducible reference versions, not a claim that they are the latest releases.
Install the optional test dependencies with `npm ci --prefix tests/react-reference`
and run `npm run test:ui:react`. The browser suite covers all three Rust execution
backends, Strict Mode, Activity, committed callbacks during a suspended transition,
a real Radix Dialog portal, React context/class components, React SSR/hydration and
readable streaming, plus owned-root disposal. No React dependency is downloaded by
the compiler SDK itself.

## Browser Rust values, events and multi-file projects

`ui::state<T: Clone>`, `read`, `write` and functional `modify` retain owned values
under compiler-generated schemas. `memo_with` and `effect_with` compare owned dependency
values, rather than relying only on string tokens. Reads/writes clone supported
records, enums, vectors, arrays and tuples: JavaScript aliasing cannot mutate retained
Rust state behind its API. Borrowed values and unsupported types are rejected before
host linking. These are the browser compiler's supported types, not arbitrary rustc types.

`ui::on_event(node, "keydown", move |event: ui::Event| ...)` receives an owned snapshot,
including keyboard/code, pointer coordinates/buttons, modifier keys, wheel deltas and
input fields. Synchronous prevent-default/stop-propagation are explicit operations.
The native Cargo host additionally preserves exact DOM event names (`change` is not
implicitly redirected to `input`). Classic JSX keeps its documented event aliases.

`compileUI(source, {file, files, entry})` resolves reached workspace modules and retains
original file spans. The designer uses an `entryFile` distinct from the edited module.
An atomic visual edit recompiles the entry with the candidate module and guards every
reached dependency hash. Invalid candidates or concurrent edits do not overwrite source.

## Persisted designer and geometry

Selecting a UI entry creates workspace-backed `.ui.json` and `.ui.css` sidecars through
revision-checked project transactions. The JSON retains backend, entry, stylesheet,
viewport, grid and snapping. CSS survives snapshot export/import, rather than living
only in a panel field. MCP `ui_project_inspect` returns entry/manifest/stylesheet hashes;
`ui_project_set` requires those exact hashes, edit approval and a reversible checkpoint.

The canvas can move and resize selected elements with grid snapping. `CanvasLayout`
rewrites the literal positioning/size declarations while preserving unrelated CSS,
including functions and custom properties. Dynamic style expressions, invalid rectangles,
cycles and foreign insertion anchors fail instead of receiving guessed source edits.
This is source-backed absolute geometry, not a general responsive CSS constraint solver.

## Server HTML and hydration

First-party `renderToString`, `renderToStaticMarkup`, `renderUIToString` and
`exportHydratedHTML` serialize escaped HTML without invoking effects, refs or events.
Rendering does execute component code. Therefore `ui_render_html` requires execution
approval; ordinary `ui_export_html` remains non-executing artifact serialization.

Hydration validates the complete expected tree before adopting existing DOM nodes,
retains matching node identity, installs callbacks/refs after adoption and reports
mismatches through the recoverable-error contract. Identifier prefixes and form
properties are deterministic. The real-React adapter uses React's own hydration and
server stream APIs; it does not feed Ferrite hydration markers into React.

## Reversible MIR event execution

Arm the next Rust callback, then use Instruction, Source line, Back instruction,
Back source line, Restart and Continue. The same commands are available through
`ui_debug` and `UISession.debug`. Reverse steps restore bounded call frames/registers,
control state and Rust aggregate/reference alias relationships. UI state writes are
staged so a reverse step restores both execution and the event's proposed state.

Continue commits the event's resulting state and DOM rendering. Host operations that
cannot be reversed establish history barriers; committed DOM changes/effects also
close the rewind interval. Snapshot limits are explicit and eviction means history
is unavailable, not silently reconstructed. This is not reversal of network traffic,
clocks, external JavaScript, native machine code or arbitrary browser effects.
`runRust(..., {history: true})` exposes the same bounded MIR history for ordinary scripts.

## Standard Rust compilation and binary execution

The [native UI workspace](native-rust-ui.md) contains a real Rust library, a `view!`
procedural macro and a `cdylib` application. Installed Cargo handles Rust syntax,
traits/generics/lifetimes, modules, dependencies and build scripts. Native hook values
stay in Rust; a checked, versioned ABI transfers view descriptions and owned event
snapshots. An ordinary browser loads the compiled Wasm with no Cargo bridge.

Native Studio import, execution-approved MCP preview and non-executing HTML export
share that host. Native DOM trees can be inspected, but the binary does not pretend
to have browser-compiler source-node IDs or reversible MIR frames. Its native heap is
not exposed as editable browser Rust-state handles. There is no general source translator
from JavaScript to Rust: keep ecosystem code in actual React and rewrite components
incrementally, or use the standalone native Rust path.

## Reproduction

```sh
npm run check
npm test
npm run test:ui:types
npm run test:ui:browser
npm run test:ui:rendering
npm ci --prefix tests/react-reference --ignore-scripts
npm run test:ui:react
cargo test --manifest-path rust-ui/Cargo.toml --offline --locked
rustup target add wasm32-unknown-unknown
npm run build:ui:native -- --trust-projects --offline
npm run test:ui:native
```

The permanent validation workflow performs these checks plus existing installed-Cargo,
language differential, terminal, agent and HTTP IDE tests. Artifacts retain the exact
source checkout, Cargo logs, browser results and screenshots. Native browser acceptance
uses actual rustc-produced bytes, not a mocked module. `FERRITE_MEMORY_TEST=1` is a
restricted-environment alternative that executes identical HTML but does not establish
HTTP or offline-file delivery. Normal CI uses real HTTP and offline file navigation.
The reference suites test Chromium; arbitrary crates, all browsers and every React
package are not inferred to work merely because these suites pass.
