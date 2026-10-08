# Ferrite rewrite audit

Baseline: `7274726225fa7b7947371ef8ba2d3b9fd2e83f32`.

The full deployed source artifact was downloaded and extracted locally. All 31 baseline Node test entries and the syntax check pass. Passing these tests does not establish Rust conformance: several material defects are not covered.

## Reproduced locally

| Case | Baseline behavior | Required behavior |
| --- | --- | --- |
| `7u32 / 2u32` | Prints `3.5` | Integer quotient `3` |
| Local `let x` shadowing | Rejected as a duplicate binding | New lexical binding |
| Array indexed by `0.5f64` | Prints `undefined` | Compile-time rejection |
| Value-returning function with no return | Accepted; prints `undefined` | Reject a reachable unit return |
| Dereferencing a local reference | Generates invalid JavaScript `*y` | Real reference semantics or explicit rejection |
| `break` outside a loop | Generates invalid JavaScript | Source diagnostic |
| Changing a range bound in a loop | Re-evaluates the bound each iteration | Evaluate range endpoints once |
| `mod ghost;` inside a string literal | Attempts to load a module | Ignore module-looking text in strings/comments |

## Architecture review

- Three generations of compiler/IDE entry points remain in the repository.
- `MIR` contains AST statements and is not the backend's executable representation. It cannot be relied upon for stepping or verification.
- Source navigation generally selects one character; typed nodes do not carry complete file-aware spans.
- Semantic checking specializes only reachable functions, with incomplete expression typing and flow checks.
- JavaScript identifiers and arithmetic are emitted directly from Rust source rather than through typed lowering.
- The workspace has shared mutable state and repeated DOM rebuilding; compilation runs on the UI thread.
- Visualizer selection is not a common service and does not propagate to all views.
- Cargo metadata support and the native adapter are separate capabilities, but the UI labels obscure this distinction.
- Native Cargo execution needs stronger cancellation, exit-status, artifact, and integration tests.
- No browser interaction/visual regression tests run before publishing.

## Rewrite acceptance targets

1. Deterministic typed stages with source provenance and backend validation.
2. Regression cases for each reproduced defect.
3. Token-aware modules, validated project persistence and correct cache invalidation.
4. Worker compilation with stale-response rejection and bounded work.
5. A single IDE composition root; independent editor, docking, selection, project, Cargo and visualizer services.
6. Locally executed browser tests for editing, navigation, docking, multiple files and commands.
7. Honest capability reporting: Ferrite's JavaScript Rust subset and the installed native Cargo/rustc toolchain are different backends.

The JetBrains RustRover product page and official editor/project/Cargo screenshots are the UI reference. Ferrite keeps its own branding; no JetBrains affiliation is implied.
