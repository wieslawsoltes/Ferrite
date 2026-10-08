# Remaining engineering scope

The implemented browser pipeline has typed HIR, executable/verified register MIR,
optimization, JavaScript and host-assisted WebAssembly backends, capturing
closures, concrete traits, transparent aliases, where obligations, structured
pattern coverage, source-linked inspection and typed-body query reuse. The native
bridge delegates actual Cargo/rustc and rust-analyzer operations to installed
local tools. These must not be confused with full Rust conformance in JavaScript.

## Browser language and semantics

Still incomplete: user `macro_rules!`/procedural macro engines, general async and
generator state-machine lowering, associated types and full trait coherence,
higher-ranked and region/lifetime solving, arbitrary generic impls, const
generics/evaluation, complete numeric inference, platform-specific standard
library and unsafe/FFI/ABI semantics. Type aliases and function where bounds are
implemented, but do not claim all generic Rust constructs.

Patterns now include nested enums/tuples/records, alternatives, bounded integer
and character ranges, and let-else. Reference binding modes, @ bindings, slice
patterns, open-ended ranges and arbitrary computed constants remain unfinished.
The move/loan analysis is conservative and whole-local, not full field-sensitive
rustc NLL. Passing tests must never be described as a soundness or compatibility
proof for arbitrary Rust.

## Backend, tooling and project handling

WebAssembly executes genuine emitted control flow and calls with the Ferrite
checked host ABI. A standalone WASI/native standard-library runtime is absent.
LLVM IR, assembly and object artifacts come from the installed native toolchain,
not a JavaScript LLVM reimplementation. Native debugging/LLDB integration is not
implemented; browser MIR debugging is implemented.

Cargo workspaces, local path dependencies, target selection and supported
features/cfg work in the browser. Registry packages, build scripts and full Cargo
resolution execute in the explicitly trusted native backend. Credential and
publishing actions are intentionally excluded from the browser bridge.

## IDE and performance

Docking, source synchronization, native semantic navigation/refactor preview and
literal Find/Replace are implemented. Full RustRover product/visual parity,
advanced editing/refactoring workflows, native debugger integration and Git commit/merge/push
UI remain incomplete. Trusted remote/local repository loading, persistent native Cargo
workspaces, crate editing, source conflict checks and piped stdin/EOF are implemented. Search is deliberately literal; semantic rename
uses rust-analyzer instead.

Incremental reuse exists for unchanged file parsing, typed bodies and completed
projects. Pure file parsing also runs in a deterministic worker pool. Native repository sessions
reuse real Cargo on-disk caches. Fine-grained semantic query tracking, parallel shared-state
browser passes, persistent browser compiler caches and broad reproducible performance
studies remain work items. Timings are
measured per workload, not universal speedup claims.

All supported stages must expose actual compiler data and original-file spans.
Unsupported syntax must produce explicit diagnostics. Changes to source or
constraints must invalidate stale results. Browser releases must pass the real
HTTP/Chromium acceptance suite, and native changes must be exercised with actual
Cargo and rust-analyzer, in addition to unit tests.
