# Registry crates and derive macros

Open `examples/registry-app/Cargo.toml` through a native repository session. Leave
Offline disabled for the first build. Installed Cargo resolves serde/serde_json,
compiles their actual code, executes the derive macro and creates Cargo.lock.
After a successful build the lockfile appears in the IDE; enable Locked for
subsequent lock-preserving builds. Commit the generated lockfile for reproducible
application dependency versions.

This example intentionally requires registry access or an already populated
Cargo cache. It was not downloaded or compiled in the offline authoring container.
Use the Crates tool to add, remove, rename or configure further dependencies.
