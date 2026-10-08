# Ferrite — browser Rust subset compiler and JetBrains-inspired IDE

Ferrite provides an educational **Rust-like subset compiler** written in modular ES2022 JavaScript. Edit multi-file projects, inspect compiler passes, navigate source-linked token/AST/type/MIR/call-graph views, and execute supported programs in a time-limited Web Worker.

**Playground:** https://wieslawsoltes.github.io/Ferrite/  
**Source:** https://github.com/wieslawsoltes/Ferrite

## Rust subset implemented

- Function declarations, parameters, return types, primitive generic type parameters and bounds
- Primitive types `u32`, `i32`, `usize`, `f64`, `bool`, `char`, `&str`; arrays of compatible elements
- Expressions, precedence, arithmetic, boolean logic, comparisons, unary operators, indexing
- `let`, `let mut`, assignments, blocks, `if`, `else`, `while`, `loop`, `break`, `continue`
- `for i in a..b` and inclusive `for i in a..=b`
- Struct declarations, named-field struct literals and field access
- Literal/wildcard `match` expressions with basic exhaustiveness and arm type checking
- Basic `Display`, `Copy`, `Clone` bounds; `println!`, `print!`, `format!` subset
- Reachable generic specialization with **isolated per-instance call targets**
- Source locations, tokenization, AST, static analysis, educational CFG/MIR, and JS generation

**Not rustc:** Complete Rust ownership/borrowing, move semantics, lifetimes, traits/impls, macros, closures, async, enums, unsafe Rust, precise Rust arithmetic and type inference, const generics, and LLVM/native/Wasm code generation are still missing. The MIR view is educational, not rustc MIR.

## RustRover-inspired IDE

- Tree-based project navigation and multiple editor tabs
- Rust code editing, line-number gutter, run marker, keyboard shortcuts and draggable tool windows
- Automatic debounced compilation and manual check/run
- Navigate between source code and token/AST/symbol/MIR/generic/call-graph visualizations
- Compiler stage timings and bounded compilation-result cache
- Search Everywhere-style command palette: **Ctrl/Cmd+Shift+P**
- Cargo tool window showing the package, targets, workspace members and dependencies
- Browser local workspace persistence and example projects

The UX takes design cues from the JetBrains New UI and RustRover, but does **not** claim complete visual or functional parity.

## Cargo support

The browser provides a constrained `Cargo.toml` parser (tables, arrays, inline tables), source-module assembly and internal check/run over its supported Rust subset. It does **not** download dependencies or implement full Cargo.

To use **real Cargo**, export the project snapshot from the IDE toolbar and run the local Node adapter with an installed Rust toolchain:

```sh
node tools/cargo-native.mjs --snapshot ferrite-project.ferrite.json --command check
node tools/cargo-native.mjs --snapshot ferrite-project.ferrite.json --command build
node tools/cargo-native.mjs --snapshot ferrite-project.ferrite.json --command run
node tools/cargo-native.mjs --snapshot ferrite-project.ferrite.json --command test
node tools/cargo-native.mjs --snapshot ferrite-project.ferrite.json --command metadata
```

The local runner materializes a temporary Cargo project, invokes the actual native `cargo` executable, and removes temporary files when complete. **Run only snapshots you trust:** native Cargo dependencies and build scripts can execute arbitrary code, and the runner does not sandbox them.

## Development

```sh
npm test
node tools/check-syntax.mjs
python3 -m http.server 8080
```

Open http://localhost:8080. GitHub Actions runs JavaScript syntax validation and regression tests; GitHub Pages deploys on pushes to `main`.

## Architecture

See [modular compiler](docs/modular-compiler.md), [roadmap](docs/roadmap.md), and [architecture overview](docs/architecture.md). Compiler stage classes live in `src/compiler/`; Cargo tools in `src/cargo/`; IDE tools in `src/ide/`; visualizers in `src/visualizers/`.

## Security

The browser worker timeout and local-storage persistence are usability mechanisms, **not a hardened security boundary for untrusted code**. The compiler and native adapter are prototypes. There is no license selected yet.
