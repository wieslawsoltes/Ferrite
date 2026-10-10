# Compiler output and visualizations

The Compiler tool window consumes one shared stage contract for both Cargo-based
Ferrite projects and Rust UI views. Open it from the sidebar or Search Everywhere
(`Show Compiler tool window`). Profile shows measured worker pass timings.

## Commands and sample loading

Opening a compiler example from Samples performs a check even when Auto-check is
off. Opening a UI sample builds its isolated preview and publishes that same
compilation to Compiler, Profile, Problems and Structure. Restoring a saved UI-only
workspace does not require a `main` function or a previous ordinary Rust build.

Explicit Check reveals Compiler. Build reveals both Compiler and Run, where the
artifact/download result is explained. UI Run and Debug compile the selected view,
publish its pipeline and launch the isolated UI; they do not execute an invented
Rust `main` or imply terminal stdout. UI Test checks the source and explains that
no Cargo test target was run. Background checks refresh data without selecting a
tool window or restarting a live UI preview. Opening a designer or changing its
presentation no longer collapses the user's compiler/output tool windows.

Each retained UI document restores its own inspected build when selected. Source
links use the original workspace file spans, including external modules. An old
workspace, changed source revision, different active UI entry, cancellation or
changed optimization setting cannot publish a late result as current. Failed
compilation explicitly disables stale artifacts and reports its diagnostic; a
subsequent successful compilation restores the selectors and visualizations.

## Pipeline contract

`compilerStages` builds the inspector stages from actual compiler artifacts. Cargo
projects retain their 21 stages. UI projects expose 21 stages with UI source nodes
instead of a fabricated Cargo plan. MIR/CFG, optimized MIR, verification, emitted
JavaScript/source mappings and WebAssembly describe the linked UI program, not the
temporary Rust ABI declaration bodies used to type-check UI intrinsics. AST, HIR,
types, captures, ownership and the source call graph describe frontend analysis.
The call graph starts at the selected entry rather than hardcoding `main<>`.

UI compiler operations accept `inspection: true` internally and return `build`
alongside their existing results. Inspector artifacts are produced during the
same compilation, not by running a second compiler. The default SDK and agent
responses remain compact. The HTML exporter selects runtime fields explicitly;
inspector metadata is not copied into the downloaded app or preview iframe.
`optimize: false` now reaches the UI compiler from the IDE toggle.

Profile includes UI view expansion/module parsing, ABI linking and verification,
and linked JavaScript/WebAssembly emission. UI builds currently compile fresh;
they do not claim parser-cache hits, parallel parsing or incremental query reuse.
Empty stages state that they have no entries. Native Cargo keeps its real streamed
output and dedicated native-artifact/timing tools; browser stages do not claim to
be rustc internals.

## Regression checks

Run `npm test` and `npm run check` for compiler contracts, source maps, inspector
transport, exports, optimization options, request lifetimes and deterministic
worker/SDK bundles. `npm run test:compiler-output` uses Chromium over HTTP to test
Rust/UI sample opening, cold persisted UI startup, all inspector stages, profile,
Run/Check state preservation, executable JavaScript/Wasm downloads, error recovery,
and source-linked retained document switching. CI runs this suite and retains its
screenshots and result JSON in the standard validation artifact.

`FERRITE_MEMORY_TEST=1` is a restricted-environment alternative. It runs the same
production module graph with in-memory delivery and explicitly skips the HTTP
persistence/reload case; it is not evidence of HTTP delivery or storage support.
