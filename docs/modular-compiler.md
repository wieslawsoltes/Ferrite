# Compiler architecture (modular stage API)

Ferrite is an educational Rust **subset**, not rustc. Each compiler pass is separated into a single-responsibility ES module.

| Module | Responsibility |
|---|---|
| `src/compiler/Lexer.js` | Tokenization and source positions |
| `src/compiler/Parser.js` | Rust subset AST construction |
| `src/compiler/SemanticAnalyzer.js` | Names, primitive type compatibility, simple trait obligations, reachable instances |
| `src/compiler/MirLowerer.js` | Educational basic-block MIR visualization |
| `src/compiler/JavaScriptEmitter.js` | JavaScript backend for supported nodes |
| `src/compiler/CompilerCache.js` | Bounded LRU reuse of unchanged crate compilation |
| `src/engine.js` | Stable functional API, pass orchestration and timing |
| `src/cargo.js` | Cargo manifest subset and local module stitching |
| `src/project.js` | Project compilation and visualizer stage composition |

The LRU cache uses exact concatenated source strings as keys. It is intentionally bounded (24 projects), not a query-level incremental cache, and cannot reuse a changed function independently. It avoids repeated identical compiles while toggling visualizers or invoking check/run without edits.

## Fidelity and important exclusions

- RustRover's current website describes smart completion, inspections, refactoring, debugging, crate navigation, and integrated Cargo. Ferrite's interface is a **visual approximation**, not full product feature parity.
- Generic instantiation is educational; full Rust generics, coherence, associated types, lifetime inference, ownership, macros and borrow checking are not present.
- Cargo support does **not** yet run actual Cargo, resolve crates.io, use Cargo.lock, execute build scripts or host workspaces.
- The MIR view is an illustration of control-flow blocks, not rustc MIR.
- Multi-file support stitches supported `mod name;` declarations into one compilation input and does not model the full Rust module/path system.

## Performance

`CompilerCache` caches completed compilation results keyed by exact merged source text. Per-pass wall clock values are measured only for cache misses. For cache hits, previous pass times remain attached to the result; they do not represent current elapsed compile work. A future revision should expose cache-hit status separately and implement incremental semantic query invalidation.
