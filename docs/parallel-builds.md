# Parallel compilation: scheduling, determinism and measurement

## Native Cargo

Native repository and snapshot commands share a weighted, FIFO `BuildJobBudget`.
The default capacity is Node's available CPU parallelism, capped at 256, or an
explicit bridge `--max-jobs N`. Each admitted Cargo compilation receives `--jobs N`.
Cargo then schedules its dependency graph, compiler invocations, build scripts and
jobserver-aware code generation. Ferrite does not replace Cargo's dependency
resolver or independently launch dependent crates before prerequisites complete.

One checkout is serialized to prevent simultaneous editor synchronization/build
mutations. Independent sessions can run concurrently across clients when their
requested job weights fit the bridge budget. Auto reserves the complete budget;
request smaller per-build job counts for concurrent independent builds. Queued
cancellation removes only that request; completion/failure releases exactly once.
This is admission control, not an OS thread/process quota: arbitrary application
threads and separately started language-server work are not sandboxed by it.

Changing job counts does not disable borrow checking, diagnostic generation, MIR
verification or alter the chosen optimization profile. No unsafe compiler flags,
nightly frontend overrides, or reduced-quality builds are introduced. Workloads
with long dependency chains cannot utilize every job at every instant.

**Profile** displays the admitted job count, fresh/rebuilt artifact counts and
process wall time. These counts are not claims about simultaneous CPU utilization.
Enable **Generate Cargo timing report** to inspect the actual Cargo HTML unit and
concurrency graphs. The report is displayed in an opaque-origin sandboxed iframe
with no external-resource permissions, rather than reconstructed from guessed
artifact timestamps. Reads are bounded to 2 MiB and restricted to the selected
repository. An unchanged prior report is explicitly omitted; no stale timing is
presented as a measurement of a failed/new build. Reports outside the selected
root remain on disk but are not read by the editor API.

## Browser compiler

The persistent compilation worker owns an isolated `CompilerSession` and its
semantic state. A nested `ParserWorkerPool` runs the **same production Lexer and
Parser** concurrently for independent changed Rust files. This is real CPU worker
execution, not Promise.all around synchronous parsing.

Workers are retained between edits. Requested parallelism is 1–8; Auto uses up to
four available hardware workers. Auto avoids cold worker overhead below 65,536
source characters and retained-worker overhead below 8,192 characters. An explicit
worker count removes that size threshold but still needs two changed files.
One worker selects the ordinary serial reference path.

Work dispatch is longest-file-first to reduce uneven tails. Results are placed in
original filename slots, then adopted into bounded caches in filename order. The
cache eviction order does not depend on which worker finishes first. Tokens,
syntax trees and original UTF-16 source ranges are preserved through structured
clone, without shared writable ASTs. Inactive modules can have deferred syntax
errors: a worker error is reported as a source error only if ordinary module
resolution actually reaches that file.

Worker startup/transport/deadline failures dispose the pool and fall back to the
ordinary parser, with a visible fallback reason. Cancellation discards the
outstanding batch before adoption. Edits coalesce at the existing compilation
service and stale replies cannot replace a newer source revision.

**Not all browser stages are parallelized.** Module/name resolution, type/trait
analysis, ownership checking, generic discovery and final verified backend emission
retain their ordered shared-state implementation. Native Cargo parallelizes actual
crate builds; this JS change parallelizes file lexing/parsing, not every internal
rustc pass. Native full-Rust support is not a claim of full Rust in JavaScript.

## Profiles and tests

The Profile panel shows actual parser lanes, dispatch start/end intervals and
source-linked file rows. Selecting a lane selects its original file; source edits
invalidate the rows. Lane intervals include startup, queue and transfer costs.
Summed worker lex/parse durations are not additive project wall time and should
not be presented as sequential CPU percentages.

`tests/parallel-parser.test.js` uses real Node worker_threads loading the production
parser module. Serial and parallel builds must agree exactly on tokens, AST, HIR,
MIR, optimized MIR, verifier output, generated JavaScript and Wasm bytes. Other tests
cover inactive invalid sources, reachable diagnostics, cancellation, bounded cache
ordering and serial fallback. Chromium acceptance uses actual production nested
browser workers and executes the resulting program through MIR and Wasm.

```sh
# files, functions per module, iterations; uses real Node parser threads
node tools/parallel-benchmark.mjs 4 20 5
```

The benchmark reports each observation and its environment. It measures cold
compiler caches and either cold or retained worker processes, not a warmed exact
project-result cache. Structured-clone/startup costs can outweigh parallel work.
Native Cargo, Node workers and browsers must be measured separately; a universal
speedup is not inferred from this benchmark. For very large function counts, the
unchanged semantic/backend phases can dominate overall runtime.

References: [Cargo jobs](https://doc.rust-lang.org/cargo/commands/cargo-build.html#miscellaneous-options),
[Cargo timing reports](https://doc.rust-lang.org/cargo/reference/timings.html).
