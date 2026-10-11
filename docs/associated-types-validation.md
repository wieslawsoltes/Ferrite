# Associated-type continuation: native validation

The source tree `413e79ea3985e11e92f6ce85887541f2361fe7a3` passes
**2,029 Node tests**, including **130 associated-type tests**, and the unchanged
**1,069-case native differential corpus**. The retained local report records
`mode: rustc-differential`, `failed: 0`, and `nativeValidated: true`.

Validation was performed on October 11, 2026 with rustc 1.99.0
(`b940084d7eb6a299eb4bfeb8e34901bc051e7ac4`, LLVM 23.1.1), exported from the
repository's GitHub Actions runner. The compiler archive checksum was verified
before use. The local host uses its installed C linker with rustc options
`-C linker=cc -C link-self-contained=no -C linker-features=-lld`; this only selects
the host linker and does not disable type, ownership, constant, or overflow checks.

The corpus uses Rust edition 2024, native optimization levels 0 and 3, overflow
checks enabled, and both browser optimization settings across MIR, JavaScript,
and host-assisted WebAssembly. The original native E0599 discrepancy is fixed
and retained unchanged as a rejection regression, not removed or exempted.

The earlier source-only package had no native compiler available and explicitly
reported `nativeValidated: false`. This later run closes that native-oracle gap.
The ordinary repository CI remains authoritative for normal HTTP/browser,
installed Cargo, native UI, agents, terminal, debugger, and integration acceptance.
Its complete unchanged workflow must pass on the published PR head before merge.

See [associated-types.md](associated-types.md) for implementation semantics and
remaining Rust compatibility boundaries. Passing this corpus does not establish
complete Rust language or standard-library parity.
