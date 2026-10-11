# Nominal variance and constrained type parameters

Ferrite infers declaration-owned type-parameter variance for structs and enums.
The pass rejects unused or purely recursive, unconstrained parameters even when
no instance is constructed. It also admits parameters determined by explicit
associated-output equations. The analysis runs in the browser compiler itself;
it does not delegate compilation to rustc.

The complete [example](../examples/09-nominal-variance.rs) combines a nominal whose
second parameter is determined only by an associated output with a function-pointer
field using generic `Self`. It prints `7` on MIR, JavaScript and host-assisted
WebAssembly.

## Field variance

Field types generate constraints over a four-element lattice: bivariant,
covariant, contravariant and invariant. Ordinary fields, tuples, fixed arrays,
shared references and compiler-owned `PhantomData` preserve polarity. Function
inputs reverse polarity; mutable reference targets and associated-projection
inputs impose invariance. Nominal arguments compose with the variance inferred
for the corresponding declaration slot. A user-defined `Vec` is analyzed from
its fields, not mistaken for the compiler's covariant builtin collection.

Aliases and defaults resolve in their own declaration scopes. An isolated
resolver preserves associated-projection inputs before output equalities or
blanket implementations can normalize them away. Thus `struct S<T: A<Item =
u8>>(T::Item)` still depends on T, even though its stored output normalizes to u8.

Neither ordinary trait bounds nor concrete implementation bodies determine a
nominal's field variance. No variance is inferred for function, trait or impl
parameters.

These examples differ intentionally:

```rust
// Rejected: no constraint seeds T's variance.
struct Recursive<T>(fn(Recursive<T>));

// Accepted: T supplies an independent constraint.
struct Anchored<T>(T, fn(Anchored<T>));

// Also accepted by native Rust: invariant ambient composition constrains T.
struct Invariant<T>(fn(&mut Invariant<T>));
```

Ambient composition is asymmetric: invariant composed with bivariant is
invariant, whereas bivariant composed with invariant remains bivariant. A simple
textual occurrence check or an unconditional cycle rejection gives incorrect
results for these cases.

`Self` in supported nominal fields and function-pointer signatures retains the
owner's full generic application. Explicit `Self<T>` is rejected with E0109;
Self itself cannot take another set of arguments.

## Output-constrained parameters

A parameter with bivariant field usage is valid when an explicitly declared
associated output determines it from already constrained projection inputs:

```rust
trait Source { type Item; }
struct Reader<S: Source<Item = T>, T>(S);
```

Here S is covariant, and T remains **bivariant** in field variance while being
marked `constrainedByOutput`. Output evidence never changes field polarity.
Forward closure handles chains, structured outputs, nested associated-bound
syntax and the builtin Fn/FnMut/FnOnce output. All projection inputs must be
known first. A projection nested inside an output is non-injective: knowing
`U::Item` cannot determine U.

The declaration must state the equation. Merely inheriting an equality through
`T: Child<U>` does not constrain an unused U. However, `T: Child<Item = U>` can
name an associated member declared on a parent trait. Defaults, marker bounds,
method bodies and associated constants do not count as nominal field usage.

## Implementation, limits and metadata

Hash-consed transform vertices and reverse dependency edges form a finite graph.
A worklist starts slots at bivariance and propagates only changes. Each vertex
refines at most twice; a mutually recursive or expanding application never
causes nominal-body expansion. Propagation is linear in the graph size, after
bounded parsing and type-resolution work. The output-constraint closure uses
hyperedges with missing-input counters, not repeated whole-declaration scans.

State is declaration-index-local. A private type/default/projection/hierarchy
view shares immutable declarations but no query caches, CTFE state, callable
identities or implementation-selection cache. A budget or type failure publishes
no partial result and resets the active-query guard. Graph nodes, edges, work,
type size, traversal depth and output-dependency growth have explicit limits.
The underlying namespace, alias and trait services retain their own limits.

`artifact.sem.nominalVariance` is a JSON-serializable readonly report, with typed
SDK declarations. It contains per-declaration parameter names, variances, validity
and output-constraint flags, plus graph/work/refinement counters. Internal graph
vertices and solver dependencies are not executable MIR data.

The existing MIR representation, JS backend and host-assisted Wasm runtime are
unchanged. Concrete field and function-pointer types are normalized before
lowering; there is no runtime variance operation, thunk or equation interpreter.

## Validation

```sh
node --test tests/nominal-variance.test.js
npm test
npm run check
npm run test:language
npm run test:variance:native
```

The shared source fixtures exercise accepted programs on optimized/unoptimized
JSON-round-tripped MIR, JavaScript and host-assisted WebAssembly. The normal
language differential corpus compiles the same sources with native Rust edition
2024, optimization levels 0 and 3 and overflow checks enabled. Native compiler
absence fails rather than silently downgrading to browser-only evidence.

`test:variance:native` adds deterministic generated declaration graphs and
native-only lifetime cast probes in both directions. Those cast probes observe
the actual variance inferred by rustc and compare it with Ferrite's report; they
do not imply that Ferrite compiles lifetime syntax. The seed and complete probe
sources are retained in `artifacts/variance-conformance.json`. CLI options are
`--cases=N`, `--seed=N`, `--output=FILE`; `RUSTC` selects the oracle binary. The
normal CI runs this gate in addition to every existing language/browser/IDE gate.

Dedicated tests also cover source-order independence, resource failure/retry,
immutable ASTs, main-cache isolation, actual typed-HIR query replay and invalidation,
and absence of checking-only identities from executable artifacts.

## Remaining compatibility limits

This is nominal variance inference and declaration-parameter validation, **not**
variance-aware expression coercion, lifetime analysis, NLL, higher-ranked type
checking or a complete DST ABI. Rust's native recursive-only diagnostic has no
numbered code; Ferrite groups unused and recursive-only failures under E0392
with a source span and corrective note.

A generic `Self` whose owner has the same name as one of its own type binders,
such as `struct X<X>(X, fn(Self));`, remains rejected with E0109 because Ferrite's
canonical string identities cannot yet distinguish that owner from its binder.
This is valid native Rust and has a separate boundary test, not a falsely labelled
native compile-fail fixture. Complete hygienic nominal/binder identities remain
separate work.

Existing GAT, const-generic, conditional associated-item, opaque-type, universal
generic-body, macro/async, full standard-library and native-code-generation
boundaries remain. Passing finite suites is not full Rust parity.

References: [Rust Compiler Development Guide — variance](https://rustc-dev-guide.rust-lang.org/variance.html),
[RFC 0738 — variance](https://rust-lang.github.io/rfcs/0738-variance.html),
[Rust Reference — subtyping and variance](https://doc.rust-lang.org/reference/subtyping.html),
and [E0392](https://doc.rust-lang.org/error_codes/E0392.html).
