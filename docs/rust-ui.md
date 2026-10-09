# Rust UI Studio

This work adds a reusable React-like DOM runtime, a Rust UI compiler frontend, source-based visual design, UI debugging, MCP integration, an embeddable compiler SDK, and self-contained HTML export.

## Compatibility contract

- The JavaScript component runtime implements its own public component/hook APIs. It does not use React private internals and is not a claim of complete React compatibility.
- Browser Rust UI compilation uses Ferrite's existing typed Rust subset. `view!` is a first-party, source-mapped macro frontend; expressions and callbacks are checked and compiled as Rust, not rewritten into JavaScript expressions.
- The UI linker recognizes only compiler-owned declarations in the reserved `ui` module. Their explicit trap bodies cannot silently execute as fake implementations. Linked calls cross a checked, versioned host ABI.
- MIR enables instruction/source debugging. WebAssembly uses Ferrite's checked externref host ABI, not WASI or a standalone native executable. Generated JavaScript remains another backend of the same verified MIR.
- Full Rust language/crate support still requires an installed native Rust toolchain. This extension does not remove the existing compiler's documented limitations.
- Exports must contain their runtime and compiled program, escape embedded source, and avoid network dependencies. Designer previews run in an opaque-origin, script-only sandbox.
- Retained Rust event/component/effect callbacks require owned `move` captures, with no borrowed references crossing the asynchronous DOM lifetime.

Implementation details, examples, validation commands, and remaining compatibility gaps are recorded here as the PR is completed.
