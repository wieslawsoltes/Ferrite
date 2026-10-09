# Compiler conformance evidence

Ferrite's browser compiler and installed Cargo/rustc are separate implementations.
Passing a finite suite does not establish full Rust language or standard-library parity.

## Reproducible validation

- `npm test` exercises the compiler, runtimes, IDE services and checked-in samples.
- `npm run check` checks source syntax and exact generated worker bundles.
- `npm run test:language` compiles reviewed fixtures with installed rustc, edition 2024,
  at optimization levels 0 and 3 with overflow checks enabled. It compares acceptance,
  stdout and panic exit status against optimized/unoptimized MIR, JavaScript and
  host-assisted WebAssembly. Results and source SHA-256 hashes are retained in
  `artifacts/language/conformance.json`. A missing native toolchain fails the run.
- `npm run test:language -- --browser-only` deliberately omits native validation;
  the report sets `nativeValidated: false` even when every browser check passes.
- `npm run benchmark:verifier -- --baseline-ref <commit> --iterations 25` measures
  paired, alternating-order verifier timings. Synthetic stress results are not
  end-to-end compilation or application speedups.

## Current scope

The compiler covers the added primitive operators and strict literals, structural
array/tuple/rest/@ patterns, declaration-scoped MIR constant evaluation, lexical
labels and expression-valued control flow. The verifier's packed definite-assignment
analysis is checked against an independent Set-based oracle over generated CFGs.

IEEE numeric values survive JSON serialization of MIR, optimizer constants, generated
JavaScript and the WebAssembly ABI. NaN, infinities and signed zero have distinct literal
encodings. Constant-array compaction distinguishes the two zero signs. Assertion
equality compares values recursively instead of comparing truncated debug strings;
NaN remains unequal to itself, including inside an aggregate. This is a builtin
structural operation, not general user-defined PartialEq trait dispatch.

Unsuffixed floats accept surrounding f32 context in supported annotations, function
arguments, return values and aggregates. Explicit suffixes remain binding; integer
literals are not implicitly converted to floats. General bidirectional numeric/type
inference, exact Rust float formatting and NaN payload-bit preservation are not claimed.

Full user macros, async/generators, lifetime/NLL analysis, const generics, advanced
trait/associated-type solving, reference/slice patterns, native ABI/code generation
and the complete standard library remain outside this browser-compiler scope.
