# Modular implementation

See [the current architecture](architecture.md) for pass contracts, span synchronization, cache behavior, UI composition and the native Cargo boundary.

`src/compiler/` contains one primary class per module; `src/project/` and `src/cargo/` own file-aware sessions and package planning; `src/runtime/` owns the MIR VM/runtime; `src/native/` owns trusted process execution; `src/ui/model/`, `src/ui/services/` and `src/ui/views/` separate state, asynchronous operations and presentation.

`src/ui/workers/*.bundle.js` are deterministic generated transport artifacts, not handwritten monoliths. Rebuild with `npm run build:workers`, verify with `npm run check`, and never edit generated files directly.
