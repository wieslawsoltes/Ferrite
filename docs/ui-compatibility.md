# UI compatibility follow-through

This work follows the merged Rust UI Studio implementation in PR #7. Each capability must have executable tests, preserve the existing compiler/IDE/agent behavior, and describe its actual compatibility boundary.

## Acceptance areas

- Owned generic Rust state and memo values, structured DOM events, and multi-file Rust UI compilation with original file spans.
- Persisted UI projects/styles and source-backed canvas position/size editing.
- Server rendering/hydration and explicit integration with the real React dispatcher for React ecosystem and concurrent-rendering support.
- Reversible deterministic Rust event debugging with bounded snapshots, without claiming reversal of external browser effects.
- A standard-toolchain Rust UI crate and browser Wasm host, with executable native/Wasm examples.
- Embeddable SDK, single-file export, shared MCP tools, examples and regression coverage for the added capabilities.

No feature is considered complete merely because an API name exists. Final implementation details, compatibility limits and validation evidence are recorded below as the changes are tested.
