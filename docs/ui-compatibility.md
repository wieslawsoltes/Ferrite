# UI compatibility follow-through

This work follows the merged Rust UI Studio implementation in PR #7. Each capability must have executable tests, preserve the existing compiler/IDE/agent behavior, and describe its actual compatibility boundary.

## Acceptance areas

- Owned generic Rust state and memo values, structured DOM events, and multi-file Rust UI compilation with original file spans.
- Persisted UI projects/styles and source-backed canvas position/size editing.
- Server rendering/hydration and explicit integration with the real React dispatcher for React ecosystem and concurrent-rendering support.
- Reversible deterministic Rust event debugging with bounded snapshots, without claiming reversal of external browser effects.
- A standard-toolchain Rust UI crate and browser Wasm host, with executable native/Wasm examples.
- Embeddable SDK, single-file export, shared MCP tools, examples and regression coverage for the added capabilities.

No feature is considered complete merely because an API name exists. Final implementation details, compatibility limits and validation evidence are recorded below as the changes are tested.

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
