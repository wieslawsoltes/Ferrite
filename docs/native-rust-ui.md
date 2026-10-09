# Standard-Rust UI and native Wasm

This path uses installed **Cargo and rustc**, not Ferrite's browser Rust-subset compiler.
The `rust-ui/` workspace contains the `ferrite-ui` runtime, `ferrite-ui-macro` procedural
macro and `ferrite-ui-example` cdylib. They have no external crate dependencies; the
example uses owned structs, closures and `std::collections::BTreeMap` inside actual Rust.

## Build and run

```sh
rustup target add wasm32-unknown-unknown
cargo test --manifest-path rust-ui/Cargo.toml --offline --locked
npm run build:ui:native -- --trust-projects --offline
```

The command writes `artifacts/native-ui/app.wasm` and `app.html`. Open the HTML directly,
with no network, compiler, server or local bridge. In Ferrite's **Rust UI Studio**, use
**Load Cargo Wasm** to select the binary, interact with its sandboxed preview, inspect
its DOM/runtime statistics, then **Export HTML** to save another independent application.
The source workspace is not replaced by imported bytes.

To build another trusted Cargo workspace:

```sh
node tools/native-ui.mjs --trust-projects \
  --manifest /absolute/path/to/Cargo.toml --package my-app \
  --output /absolute/path/to/my-app.html
```

The package must export a UI `cdylib`. Cargo resolves ordinary local/git/registry
dependencies and build scripts under its own rules; omit `--offline` only when network
resolution is intended. Crates must support `wasm32-unknown-unknown`. Operating-system,
WASI and browser APIs are not magically supplied by this DOM ABI. `--trust-projects`
is required because builds execute native code with your permissions.

## Application crate

Use this dependency with a path adjusted to your checkout:

```toml
[package]
name = "my-app"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
ferrite-ui = { path = "../Ferrite/rust-ui/ferrite-ui" }
```

```rust
use ferrite_ui::{self as ui, view};

#[derive(Clone)]
struct Model {
    count: i64,
    label: String,
}

fn app() -> ui::Node {
    let model = ui::state_with(|| Model {
        count: 0,
        label: "Native Rust".to_owned(),
    });
    let clicked = model.clone();
    view! {
        <section>
            <h1>{model.get().label}</h1>
            <output>{model.get().count}</output>
            <button on:click={move || clicked.update(|mut value| {
                value.count += 1;
                value
            })}>"Increase"</button>
        </section>
    }
}

ui::export_app!(app);
```

Unlike copied browser ABI handles, native `Signal<T>` is **Clone, not Copy**. Clone
handles explicitly before moving them into retained `Fn + 'static` callbacks. rustc
checks lifetime and ownership legality. Values implementing `Clone + 'static` stay in
Rust; no JSON schema or JavaScript cloning of those values is involved. No `Send`/`Sync`
guarantee is implied: this runtime is an instance-local, single-threaded UI owner.

The proc macro supports elements, fragments, literal/boolean/braced attributes, Rust
expression children, explicit component props and keys, refs and event bindings. Rust
expression token streams are passed to rustc rather than translated to JavaScript.
Quoted text preserves exact spaces; bare markup token whitespace is normalized. The
macro expects the `ferrite_ui` crate name, so dependency renaming needs an explicit alias.

## Lifecycle and event contract

State, memoized values, refs and effects belong to keyed component frames with actual
Rust `TypeId` identity. Hook order, kind and concrete type must stay stable. Removing a
component retires its callbacks, makes later signal writes inert and runs effect cleanup.
Setup and cleanup are separate owned closures; dependency changes run cleanup before setup.

Rendering prepares a bounded view description and a staged callback table. The host
validates it, applies DOM updates, then calls the Rust commit export. Only then do
commit effects and callback publication take place. Old callback IDs never become
aliases for different callbacks. A fault disposes the DOM/instance instead of pretending
that an invalid partial commit succeeded.

`on:click` supplies a no-argument closure. `on:input` supplies an owned string value.
`on_event:keydown` supplies an owned `ui::Event` record, including keyboard, pointer,
modifier, wheel and input fields. `ui::prevent_default()` and `ui::stop_propagation()`
apply only during synchronous dispatch. `ui::use_ref`, `node_ref`, `focus` and `ref_value`
provide checked DOM refs. Input UTF-8 is sized, copied and validated before Rust owns it.

## JavaScript SDK

```js
import {mountNativeUI, exportNativeHTML} from './src/sdk/Ferrite.js';

// Supply trusted complete bytes from an explicit file selection or your own loader.
const bytes = new Uint8Array(await file.arrayBuffer());
const session = await mountNativeUI(bytes, document.getElementById('app'));
console.log(session.inspect());
const html = exportNativeHTML(bytes, {title: 'My native Rust app'});
// Save html, and release the mounted application when its owner is removed:
session.dispose();
```

These functions also exist on `globalThis.Ferrite` in `src/sdk/ferrite.bundle.js`.
`exportNativeHTML` validates and serializes bytes; it does not instantiate them.
Exports embed the runtime, host and Wasm, with a restrictive resource CSP.

MCP `ui_native_preview` requires execution approval and a connected IDE. The generic
`ide_command` route cannot downgrade that authority. `ui_native_export_html` is read-only
because serialization does not execute the artifact. Both accept canonical inline base64,
limited to 512 KiB of base64 text per MCP request. The file picker accepts binaries up
to 8 MiB. Large result HTML uses the existing paged artifact result mechanism.

## ABI and safety boundaries

ABI version 1 requires one unshared memory32 with an explicit maximum (64 MiB by
default), no automatic Wasm start section and only approved function imports from
`ferrite_native_ui_v1`: `view_emit`, `view_invalidate`, `event_text`, `event_number`,
`dom_operation`. Required exports are `memory`, `ferrite_ui_abi`, `ferrite_start`,
`ferrite_render`, `ferrite_commit`, `ferrite_dispatch` and `ferrite_dispose`.

Pointer ranges are checked against the current memory buffer on every transfer.
Binary size is capped at 8 MiB, view JSON at 4 MiB, view nodes at 10,000, depth at 128,
and hooks per component at 1,000. The host rejects forbidden DOM tags/properties,
string handlers, malformed nodes and duplicate event/ref bindings. Cargo artifact
collection reads the complete bounded file under the project's real target directory,
rejecting symlink escapes, truncated binaries and incompatible ABI metadata.

**Native code is trusted code.** Memory bounds and iframe origin isolation are not CPU
fuel: an infinite Wasm loop can block its browser thread. Cargo builds have host
permissions. Direct SDK mounting uses the embedding page's realm. Studio uses an
opaque-origin iframe without `allow-same-origin` and rotating message capabilities.
These mechanisms do not make arbitrary native binaries a universal hostile-code sandbox.

Native inspection exposes the rendered DOM, component/hook counts, memory and call
statistics. It does not decode the arbitrary Rust heap or expose editable browser state
handles. Native source design, native server hydration and Ferrite MIR reverse stepping
are not claimed for imported binaries. Browser-compiled UI projects retain their full
source designer, hydrated export and reversible event debugger; actual React integration
uses the separate public React adapter.

## Validation

`npm run test:ui:native` consumes the actual built Wasm and tests offline clicks,
Unicode controlled input, DOM refs, independent instances, disposal, Studio file import,
opaque-origin preview and downloaded native export. `artifacts/native-ui/` retains
Cargo logs, browser results, screenshots and executable artifacts. Restricted memory
mode tests execution but deliberately does not claim HTTP/file-delivery coverage.
