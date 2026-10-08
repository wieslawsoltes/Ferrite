# Ferrite — a Rust compiler laboratory and browser IDE

[Open the IDE](https://wieslawsoltes.github.io/Ferrite/) · [Source](https://github.com/wieslawsoltes/Ferrite)

Ferrite has two **explicitly different** execution backends:

- **Browser compiler:** a JavaScript implementation of a documented Rust subset, with typed intermediate representations, executable MIR, bounded execution, a debugger and source-linked compiler visualizations.
- **Native Cargo:** an opt-in authenticated loopback connection to your installed toolchain. Cargo, rustc, dependencies, build scripts and programs run locally with your permissions—not inside the browser and not in a sandbox.

The IDE follows RustRover's compact editor and tool-window organization. It is an independent implementation, not JetBrains software or a claim of complete RustRover/Rust compatibility.

## The IDE

Edit persistent multi-file Cargo projects using document tabs, a project tree, syntax highlighting, line numbers, breakpoints, undo/redo and a command palette. Create, rename and delete files, import/export complete snapshots, switch targets and examples, or enable debounced automatic checking.

Project, Structure, Find in Files, Repositories, Crates, Cargo, Compiler, Profile, Rust tooling, Native artifacts, Run, Problems, Debugger and Tests are real tabbed tool windows. Drag a tool tab to another region, double-click to float it, use the splitters to resize, or reset the layout. Tool windows remain accessible at small screen sizes.

**Ctrl/Cmd+Shift+F / H:** find/replace across files. **Ctrl/Cmd+F / H:** search the current file. **Ctrl+Space:** native semantic completion. **F12:** definition. **Shift+F6:** native semantic rename. **Ctrl/Cmd+Enter:** run. **Ctrl/Cmd+Shift+P:** Search Everywhere. **F5:** debug/resume. **F10:** step source line. **F11:** step MIR instruction. **Alt+1:** Project. **Ctrl/Cmd+S:** save. **Ctrl/Cmd+Z / Shift+Z:** undo/redo in the active document.

Find in Files has source-linked results, include/exclude masks, explicit replacement previews, and revision-checked atomic apply/undo. Literal search is not a substitute for the separate rust-analyzer semantic rename. See [search contracts](docs/search.md).

Every compiler representation uses original-file UTF-16 spans: selecting a token, AST/HIR node, symbol, obligation, ownership event, generic instance, MIR instruction, call site, diagnostic or mapped generated-JavaScript line navigates to the source. Editor selections highlight matching visible items. Edits invalidate old spans instead of navigating into obsolete source.

## Compiler pipeline

`Cargo planning → file parsing → module/name resolution → built-in macro lowering → type/trait analysis → conservative ownership analysis → generic specialization → typed register MIR → verification → optimization → JavaScript/VM and WebAssembly execution`

The 21 stage views include token chips, lazy AST/HIR trees, symbol/type tables, ownership events, generic instances, connected CFGs, call graphs, MIR verification, optimization reports and mapped generated JavaScript. These are outputs of implemented passes, not invented LLVM or rustc dumps.

The register-MIR VM powers actual stepping, call frames, locals, breakpoints, run/pause/resume, and the browser test harness. Generated JavaScript executes the same verified MIR. Browser Build downloads an executable `.mjs` file, or a real `.wasm` module with the WebAssembly backend selected. WebAssembly retains structured control flow and calls while using the Ferrite checked host ABI for Rust values; it is not a standalone WASI binary. Native artifacts require installed Cargo.

### Supported subset

Functions, lexical locals/shadowing, numeric inference for supported cases, signed/unsigned integers through 128 bits, floats, arrays, tuples, structs, enums, Option/Result, generic functions, transparent type aliases and function `where` clauses, concrete trait implementations, closure capture and Fn/FnMut/FnOnce calls, references, selected String/Vec methods, control flow, ranges, nested enum/tuple/struct patterns, or-patterns, integer/character ranges, coverage witnesses, guards, `let-else`, `if let`, `while let`, `?`, modules/use paths, constants and selected built-in macros. Browser tests recognize `#[test]`, `#[ignore]` and `#[should_panic]`.

Ownership checking is a **conservative whole-local move/loan model**, not rustc's full non-lexical lifetime analysis. General async/generators, procedural/declarative user macros, higher-ranked closure/lifetime bounds, full associated-type/trait coherence, complete lifetime and const-generic semantics, platform ABIs and LLVM/native object generation are not implemented by the JavaScript frontend. Unsupported features produce diagnostics; the native example explicitly uses installed Cargo.

The sample catalog includes a multi-file geometry/trait application, Option pattern loops, a Result pipeline, a local Cargo workspace with a path dependency, test-harness behavior, u128 arithmetic, capturing closures, Cargo feature selection, pattern coverage, aliases/where constraints and an ownership error. A native-only sample demonstrates async syntax and `macro_rules!`; those features are compiled by the installed toolchain, not fabricated in the browser.

## Run locally

Requires Node.js 22+ for development tools. Runtime browser code has no npm dependencies.

```sh
npm test
npm run check
python3 -m http.server 8080
```

Open `http://localhost:8080`. Classic compiler/execution worker bundles are checked in and generated deterministically from granular ES modules:

```sh
npm run build:workers
```

The bundles avoid a worker module-import waterfall. The persistent compiler worker owns bounded file-parser, typed-body query and exact-project result caches. Body changes invalidate the edited function; signature, alias and obligation environment changes invalidate dependent semantic results conservatively. The Incremental queries view reports real cache hits and dependencies. This is not a full rustc query-engine implementation. Cache hits are explicitly labeled and do not replay stale pass timings. Timing bars are measured wall-clock pass durations, not CPU profiles or universal speedup claims.

## Git repositories, full applications, and parallel builds

**Repositories** opens trusted HTTPS/SSH Git clones or authorized local Cargo directories.
Repository sessions retain complete files, binary assets, configuration and native build caches;
the editor receives a bounded text projection. Select a nested Cargo manifest, workspace package
and target; builds run from the manifest directory through actual installed Cargo/rustc.
**Crates** adds/removes registry, Git and path dependencies through Cargo, with feature, rename
and dependency-section options. Manifest/lockfile changes are conflict-checked and synchronized.
The Run panel streams native output and supplies stdin or EOF; native GUIs run on the local machine.

```sh
node tools/cargo-bridge.mjs --trust-projects --origin http://localhost:8080 \
  --allow-root /absolute/path/to/repositories --max-jobs 8 --port 8787
```

The bridge exposes native job, profile, target, toolchain, timeout, offline, lockfile and timing
controls. Cargo schedules real dependency builds; separate sessions share a bounded job budget.
The JS compiler now parallelizes independent file parsing in persistent CPU workers, with
ordered cache adoption and the original ordered semantic/ownership/final-verification passes.
Profile includes source-linked parser lanes and actual native Cargo timing reports.

[Repository workflows and trust boundaries](docs/repositories.md) ·
[Parallel scheduling and measurement](docs/parallel-builds.md) ·
[Full native workspace example](examples/native-workspace/README.md) ·
[Registry example](examples/registry-app/README.md)

Remote clones are temporary and removed when their session/bridge closes. Export or copy
changes first; local repositories are never deleted. Native sessions are not cloud builds,
VCS commit/push clients, hostile-code sandboxes, or a full Rust compiler in JavaScript.

## Native Cargo

With Rust/Cargo installed, start the bridge only for trusted projects:

```sh
node tools/cargo-bridge.mjs --trust-projects --origin http://localhost:8080 --port 8787
# For the Pages site, use --origin https://wieslawsoltes.github.io instead.
```

Use **Native bridge** in the IDE, enter the loopback address and printed bearer token, and explicitly confirm project trust. The token stays in memory and is excluded from browser storage and exports. The server checks exact Origin and loopback Host, requires authentication, streams output and structured diagnostics, limits request/output sizes, and supports cancellation.

The native backend delegates check/build/run/test, metadata/tree/fetch, fmt/clippy/doc, lockfile operations and additional supported commands to the actual Cargo executable. Cargo.lock and formatted Rust-file updates synchronize back into the workspace. Credential and publishing commands are intentionally not exposed. Installed rust-analyzer supplies completion, definition, references, hover, signature help, symbols and previewed semantic rename. Native inspection emits real rustc MIR, LLVM IR, assembly and object artifacts with mapped source lines and CFG views. Native source debugging is not implemented; the browser debugger operates on Ferrite MIR.

The CLI snapshot adapter remains available:

```sh
node tools/cargo-native.mjs --snapshot project.ferrite.json --command check
```

**Security:** workers provide responsiveness and bounded execution, not a hostile-code sandbox. Native Cargo can execute arbitrary project/dependency code and access your machine. Trust the source before connecting. Browser HTTPS-to-loopback access is subject to browser local-network permission policies.

## Validation and architecture

```sh
npm test                                # compiler, runtime, project, service and sample tests
npm run check                           # syntax + deterministic worker bundles
python -m pip install playwright==1.57.0
python -m playwright install chromium
npm run test:browser                     # real HTTP document + production workers
npm run test:native                      # actual installed Cargo, offline local workspace
npm run test:repositories                # real Git/Cargo, assets, macros, stdin, jobs=1/2 parity
FERRITE_NATIVE_TEST=1 npm run test:browser # browser-to-native integration as well
```

Browser tests exercise all stage renderers, cross-file source synchronization, automatic/manual checking, file lifecycle, docking/floating, actual MIR debugging/tests, errors, persistence, export/import, cancellation and responsive tools. The optional native cases execute full Rust, inspect artifacts, exercise rust-analyzer and compare the new pattern/type examples against MIR and WebAssembly output. These are differential regression tests, not evidence of complete Rust conformance.

Restricted environments can run `FERRITE_MEMORY_TEST=1` to load the same production modules in memory. That mode deliberately does **not** claim HTTP delivery, persistence or native-network validation. The JSON evidence records the mode.

[Architecture and compatibility](docs/architecture.md) · [Patterns](docs/patterns.md) · [Type aliases and constraints](docs/types.md) · [Find/replace](docs/search.md) · [Repositories](docs/repositories.md) · [Parallel builds](docs/parallel-builds.md) · [Remaining scope](docs/roadmap.md)

Compiler classes: `src/compiler/`; project/Cargo services: `src/project/`, `src/cargo/`; VM: `src/runtime/`; native bridge: `src/native/`; IDE models/services/views: `src/ui/`. `IdeApplication` is the composition root. Legacy prototype UI implementations are removed.

No license has been selected by the repository owner.
