# Ownership-aware parameter patterns

Function and closure parameters can use the existing irrefutable pattern
language. Their bindings are checked and lowered at entry to the callee, not
by textual identifier substitution or by duplicating argument expressions.
The browser compiler performs this work itself; rustc is a differential oracle.

```rust
fn add((left, right): &mut (i32, i32)) {
    *left += *right;
}

fn first((left, _): &mut (i32, i32)) -> &mut i32 {
    left
}

fn main() {
    let mut pair = (39, 2);
    let handle = &mut pair;

    add(handle);
    *first(handle) += 1;

    let sum = |(left, right): &(i32, i32)| *left + *right;
    println!("{} {}", pair.0, sum(&pair));
}
```

Output: `42 44`.

## Patterns and scopes

The supported parameter shapes include tuples, records, tuple structs,
single-variant enums, fixed arrays, by-value array rest, tuple rest, wildcards,
`@` bindings, parenthesized alternatives, explicit `ref` / `ref mut` bindings,
reference prefixes and Rust 2024 default binding modes. Patterns must be
irrefutable: a lone `Some(value)`, for example, is rejected with `E0005`.
Top-level alternatives require parentheses. Constructor and constant names
are resolved in the declaration's module, rather than silently rebound.

Every introduced binding belongs to the function's argument scope. Duplicate
names across or within parameters are rejected, and body-local shadowing keeps
its own slot identity. A `self` receiver must be the first parameter of an
associated function. Functions without bodies retain name/wildcard parameters;
mutable bindings and destructuring in these declarations are rejected.
Closures use the same checked entry-binding pipeline. Capture discovery treats
all names bound by a parameter pattern as local, including nested closures;
true outer captures still determine `Fn`, `FnMut` and `FnOnce` behavior.

## ABI slots and ownership

The compiler allocates all incoming ABI argument slots before declaring pattern
locals. A destructured input gets an unspellable compiler-owned storage name;
a preceding pattern that introduces four names does not shift the next input's
signature index. Public signatures, call arguments, returned-reference source
indices and function pointers retain the original parameter count and order.

Checked pattern bindings are represented by compiler-owned typed-HIR entry
`let` statements. They pass through the existing ownership projection plans,
backward local liveness, reborrow lineage, coverage and MIR verification. No new
runtime opcode or separate execution path is introduced. The source AST does
not contain these generated statements. Pattern locals and prologue operations
retain the original parameter's source span for diagnostics and inspection.

`ref mut value: T` borrows the callee's own incoming value; it cannot return a
reference to that stack storage. By contrast, a tuple pattern over `&mut (T,U)`
can produce disjoint references to the caller's original fields. Explicit
`&mut value: &mut T` moves or copies the *referent*, according to declaration-owned
`Copy` evidence; `mut` on a binding and a mutable-reference binding are different
operations. Wildcard arguments still evaluate their actual expressions once.

Returned references use the existing signature contracts, including elision
and receiver selection. Choosing one field in a callee's pattern cannot narrow
a caller loan of the whole argument. Explicitly passing a disjoint projected
argument retains that projection's precision. Borrowing a copied owned input
cannot manufacture an external reference origin.

Computed reference-returning builtin receivers are now lowered through one
checked receiver register rather than demanding that a call expression itself
be a syntactic place. `first(&mut pair).push(item())`, for example, evaluates
the receiver call once before its argument and mutates the original vector.
It does not bypass the caller-loan check on the later argument.

## Generic evidence and closure inference

Structural parameter patterns need declaration-visible shapes. A bare `T`
cannot become destructurable merely because one call specializes it to a tuple,
record or array. Declared structures such as `(T,U)` and associated-output
equalities are supported. The same declaration-shape proof also applies to
local patterns. Generic and associated origins follow each introduced binding;
concrete `Copy` substitutions do not grant undeclared copying privileges.

Generated closure functions preserve the surrounding generic environment and
their parameter's symbolic source origin. An explicitly annotated reference
input, or a reference input established by an independent callable context,
can reborrow an actual mutable handle. A later direct call that first infers
an unannotated `|value|` or `|_|` input instead moves a mutable handle. It does
not retroactively introduce a reusable coercion site. Such late inference also
cannot add an implicit reference prefix to a structural parameter pattern.
Unannotated reference-carrying parameter patterns fail explicitly with
`F_CLOSURE_INPUT_REGION`: their fixed, type-owned input lifetimes cannot yet
be retained across closure calls. An explicit parameter annotation is required
for supported borrowed patterns, including callable-context cases. This prevents
repeated exclusive borrows and escaped input regions from being accepted merely
because the runtime closure value stores no reference.

This does not implement a new general bidirectional closure inference engine.
Some inference diagnostics differ from rustc. The existing monomorphized body
checker can still infer an unannotated closure from a later argument where
rustc requires an earlier annotation. The continuation does not claim to fix
all pre-existing inference differences.

## Isolation, caching and resource limits

The generated entry prologue is instance-local. Parameter patterns participate
in declaration-environment cache keys, so pattern-only changes invalidate
callers and cannot reuse stale binding layouts. Tests replay actual type,
ownership and MIR queries and compare reports. Closure-bearing programs retain
the existing policy of rebuilding anonymous declaration environments rather
than replaying them without their capture metadata.

Before checking a cloned parameter pattern, the compiler clears incoming local
slot, copy, variant, address and dereference metadata. The existing analyzer
then reconstructs those facts. A bounded iterative traversal rejects malformed
or repeated pattern nodes. Limits cover parameter count, aggregate pattern work
and depth, with failure/recovery tests. This is a parameter-boundary validation,
not a claim that every possible cyclic injected crate AST is supported by all
earlier configuration and macro passes.

## Current boundaries

This increment is not full Rust NLL, universal region inference or a memory-safety
certification. Existing lifetime/HRTB/outlives/drop limitations still apply.
Uninstantiated generic bodies are not universally checked: an unused malformed
generic parameter shape can still be accepted until instantiated. A dedicated
boundary test records that discrepancy rather than counting it as native-valid.

General by-value aggregate reference extraction, mutable reference-storage
bindings, borrowed array-rest storage and closure returned-reference contracts
remain unsupported. A destructuring closure prepared from a generic callable
context without independently available symbolic argument origins fails with
`F_PARAMETER_ORIGIN`; supplying an explicit annotation or a direct argument
origin enables supported cases. These native-valid gaps are separate capability
tests, not compile-fail entries in the native corpus.

Plain-name/wildcard inferred closure signatures retain pre-existing inference
and region limitations. The new region guard applies to destructuring/ref patterns;
it is not a complete retrofit of every existing closure signature.
Conservative inferred-closure handle moves may reject native-valid coercions.
The implementation does not add per-crate edition selection, closure region
polymorphism, custom `Drop`/destruction order, general aggregate propagation,
unsafe provenance, pinning or async-suspension ownership. Pre-existing unsupported
reference carriers are not all rejected; finite differential tests are not an
unrestricted safety guarantee.

## Validation

```sh
node --test tests/parameter-patterns.test.js
npm test
npm run check
npm run test:ui:types
npm run test:language
npm run test:parameter-patterns:native
```

Accepted fixtures execute with optimization off/on through JSON-round-tripped
MIR, JavaScript and host-assisted WebAssembly. Rejections check compiler codes
and source spans in both modes. The shared native corpus includes the exact
same sources and the complete example above, using edition 2024, native
optimization 0/3 and overflow checks. A 64-case caller-signature matrix covers
selected fields, projected arguments, shared/exclusive loans and read/write
conflicts. Frozen ASTs/tokens, capture shadowing, ABI-slot identities, genuine
query replay, forged metadata and resource-failure recovery are also tested.
A separate native gate checks that capability fixtures are accepted by rustc
and fixed-region safety fixtures are rejected, while both classes retain their
explicit browser diagnostics. Neither class is mislabeled in the main corpus.
Normal native Cargo, pinned formatting and HTTP/browser CI remain required
before merging a new revision; local backend tests do not replace those gates.

References: [Rust Reference — function parameters](https://doc.rust-lang.org/reference/items/functions.html#function-parameters),
[closure expressions](https://doc.rust-lang.org/reference/expressions/closure-expr.html),
and [patterns](https://doc.rust-lang.org/reference/patterns.html).
