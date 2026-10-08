# Architecture and contracts

## Compiler/project

`CompilerSession` owns one isolated workspace session. `VirtualFileSystem` validates project paths/text, `CargoWorkspace` plans supported local packages/targets/path dependencies, and `ModuleResolver` constructs original-file ASTs. Tokens and ASTs carry `{file,start,end,line,column,endLine,endColumn}` UTF-16 ranges. Native rustc byte offsets are converted only by `NativeDiagnosticMapper`.

The pass boundary is `CompilerPipeline`/`engine.js`: macro expansion, names, typed generic instances, conservative ownership events, typed register MIR, verification, optimization, and JavaScript emission. `MirVirtualMachine` and generated JavaScript run the same IR. `if let`/`while let` patterns are lowered into actual branching blocks, not decorative visualizer nodes. The verifier validates register/branch/call contracts and reachability before execution.

Exact file parser cache reuse is independent of whole-project semantic-result reuse. Worker scheduling coalesces pending changes and reports the original revision; the UI rejects stale replies. A compiler deadline terminates the worker and its caches, then allows a fresh request. Generated classic worker bundles eliminate module import waterfalls but preserve class-per-file authoring.

## UI

`WorkspaceModel` exclusively owns files, tabs, revisions and breakpoints. `SelectionModel` is the shared span bus. `CompilationService`, `ExecutionService` and `NativeCargoClient` isolate asynchronous boundaries. `IdeApplication` composes the services and coordinates commands; views never invoke a compiler or mutate source files directly except through the model/editor interface.

Each stage selects an adapter in `InspectorView`: `TreeView` creates children lazily, `GraphView` renders real CFG/call edges, and `SpanRegistry` indexes visible source-linked elements. Graph/token/tree item counts are bounded to prevent visualizing huge projects from unboundedly expanding the DOM. The editor invalidates old IR ranges when the source revision changes.

`DockLayout` moves the same tool view elements between three tabbed regions and floating windows. It preserves view state rather than rebuilding compiler state. Resizing supports pointer capture and keyboard controls. Tool rails reveal responsive-hidden windows in floating mode.

The debugger displays live VM frames/registers and uses MIR/source span stepping. Unit test execution uses separately collected test entry instances, ignore and expected-panic metadata, and bounded VM execution.

## Cargo boundary

Browser Cargo planning is not a Cargo reimplementation. Registry fetching, arbitrary build scripts, platform selection, complete Rust and toolchain commands belong to the real local Cargo runner. `CargoBridgeServer` exposes an opt-in loopback endpoint with exact-origin, Host and bearer checks; `NativeCargoRunner` retains one owned temporary project and `ProcessRunner` handles streamed Unicode output, timeout, cancellation and process-group cleanup.

Native file updates are applied atomically to the virtual workspace without changing the active document. A nonzero exit remains an error even when Cargo generates a lockfile. Tokens remain memory-only. The bridge is not a sandbox; projects must be trusted.

## Compatibility limits

Ferrite's ownership model is conservative whole-local analysis, not full rustc NLL. General trait/associated-type solving, complete lifetime/const generics, closures, async/generators and user macros are not implemented by the browser backend. Native Cargo is used for such programs. The IDE does not claim pixel-perfect or full functional JetBrains RustRover parity.
