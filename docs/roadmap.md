# Ferrite language and IDE roadmap

Ferrite's modular JavaScript compiler (`src/engine.js`) is a limited Rust-like language implementation, not rustc.

## Implemented

- Lexing with token positions; AST parser supporting functions, limited generics, struct declarations, control flow, mutable locals, array literals/indexing, unary/binary expressions, and return values.
- Subset semantic checking of scopes, types, generic trait bounds and reachable generic instances.
- Experimental basic-block MIR, JavaScript backend and browser Worker execution.
- RustRover-inspired project/editor/terminal/compiler layout, draggable splitters, persisted widths, samples, and profiling.

## Missing

- Full Rust grammar and macro expansion; traits and impls, enums, pattern matching, closures, async, modules, unsafe and lifetimes.
- Full type inference, trait solving and coherence.
- Move semantics, NLL borrow checker, region inference and drop elaboration.
- Full MIR verification, optimized native and WASM backends, incremental compiler, linker and cargo support.
- Complete RustRover fidelity, debugger, refactoring, language service and multi-file integration.

Run `npm test` on Node.js 20+ for the subset regression suite. This does not establish rustc compatibility. Generated JavaScript Workers are not hardened sandboxes for untrusted programs.
