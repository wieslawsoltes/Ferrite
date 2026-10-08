# Native repository laboratory

Open the Ferrite checkout through **Repositories > Local directory**, with manifest
`examples/native-workspace/Cargo.toml`. Select the `native-lab` package and binary.
Alternatively, open this directory itself with its root `Cargo.toml`.

This workspace requires installed Cargo/rustc; it is not a browser-subset sample.
It combines workspace inheritance, two independently compilable local crates,
a procedural macro, `build.rs` code generation, nested Cargo configuration,
a binary asset, scoped Rust threads, an integration test, and interactive stdin.
No registry dependency is necessary for this example.

Enable **Generate Cargo timing report**, set **Native parallel Cargo jobs** to 2
or more, and Build. Run, type a name in the Run panel, and click Send input.
For unattended execution set program arguments to `["--no-input"]`.
The integration test runs without stdin.

```sh
cd examples/native-workspace
cargo build --workspace --jobs 2 --timings
cargo run -p native-lab -- --no-input
cargo test --workspace --jobs 2
```

The four-byte asset is deliberately not representable as browser text. A native
checkout preserves it. A browser-only folder import or text snapshot does not.
Cargo must run from this workspace or a member directory so that `.cargo/config.toml`
is discovered; Ferrite's selected-manifest workflow uses that directory.

This fixture is supplied for installed-toolchain acceptance. It has not been
executed in the authoring container, which has no Cargo/rustc installation.
