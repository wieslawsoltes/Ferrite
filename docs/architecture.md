# Compiler architecture and implementation status

Ferrite is an exploratory educational Rust-like compiler targeting JavaScript. It is **not** rustc and cannot correctly compile arbitrary Rust programs.

## Implemented compiler pipeline

1. Lexing (source to token sequence; currently no spans).
2. Recursive-descent parsing (functions, basic generic parameter declarations, let declarations, basic binary expressions, calls and macro invocations).
3. Name resolution within a global function map and local variable scope.
4. Subset type checking (`u32`, `f64`, `&str`) and a built-in `Display` trait eligibility check.
5. Reachable generic instance collection (monomorphization-style per concrete type).
6. Simplified, non-executable MIR visualization.
7. JavaScript source generation.
8. Time-limited worker execution and browser-stage profiling.

## Known architectural gaps

- Rust's real parser and grammar (modules, attributes, item visibility, associated items, `impl`, traits, generics with lifetimes and const parameters)
- Name/path resolution across namespaces, crates, and imports
- Full type inference, regions, coercions, obligations and trait solver
- Pattern matching, closures, async, generators, unsafe operations and macros
- Ownership and borrow checking
- Actual MIR semantics, drop elaboration, cleanup and diagnostics
- LLVM, Cranelift, WebAssembly, native object code, incremental caching and linker
- Runtime data layout, stack unwinding, ABI, standard library compatibility

## Examples

The `examples/` directory includes six programs that exercise currently supported features, including a negative test for type checking. The in-browser menu additionally provides six quick examples.

## Security and correctness

The generated JS is executed inside a Web Worker with a timeout, not in a hardened security sandbox. Source is not suitable for untrusted multi-tenant evaluation. Because coverage is limited, syntax accepted by Ferrite should never be taken as evidence of acceptance by `rustc`.
