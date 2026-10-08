# Remaining engineering scope

Implemented behavior is documented in README and covered by compiler, service, native-lifecycle and browser acceptance tests. The following are not complete:

- Browser Rust conformance: full trait/coherence and associated types, general lifetimes/regions, rustc-equivalent non-lexical borrow checking, closure capture and call traits, async/generator lowering, user macro engines, full const evaluation and platform ABI.
- Native object, LLVM/Cranelift and WebAssembly backends. Current browser output is verified MIR and JavaScript.
- Dependency-tracked incremental semantic queries. Current cache reuses exact file parsing and exact whole-project compilation.
- Native debugger/rust-analyzer LSP, refactorings and full semantic completion. Browser debugging is real MIR debugging, not native debugging.
- Complete RustRover visual/product parity. The current compact dockable UI is an independent design using similar IDE organization.
- Registry/build-script execution directly in an isolated browser Rust toolchain. Current full Cargo operations intentionally delegate to the installed native toolchain.

Unsupported syntax must continue to produce explicit diagnostics rather than silently treating it as supported. New stages must have executable/verified compiler output behind their visualizations and span synchronization. Browser changes should pass real HTTP acceptance tests before deployment; native features should be exercised with actual Cargo, not only mocks.
