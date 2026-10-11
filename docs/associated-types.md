# Associated types and projection normalization

Ferrite's browser compiler supports **non-generic associated types** declared in
user traits and defined by their implementations. They are checked compiler type
identities, not runtime objects or JavaScript property lookups. The same
normalized types drive MIR execution, generated JavaScript and host-assisted
WebAssembly; compilation does not delegate to native rustc.

```rust
trait Source {
    type Item: Copy;
    fn get(self) -> Self::Item;
    fn keep(x: Self::Item) -> Self::Item { x }
}

struct Number(i32);

impl Source for Number {
    type Item = i32;
    fn get(self) -> Self::Item { self.0 }
}

struct Stored<T: Source> {
    source: T,
    value: T::Item,
}

fn read<T: Source>(source: T) -> T::Item {
    source.get()
}

fn main() {
    let stored = Stored { source: Number(20), value: 22 };
    let kept = Number::keep(stored.value);
    let value: <Number as Source>::Item = read(stored.source);
    println!("{}", value + kept);
}
```

Output: `42` followed by a newline.

## Declaration and trait contracts

A trait declares `type Item;` or `type Item: Bound;`. Its implementation supplies
`type Item = ConcreteType;`. Types occupy the associated **type namespace**;
constants and methods retain their separate value namespace. Missing, extra,
duplicate, inaccessible and ill-formed members are diagnosed. Trait and impl
associated members cannot introduce their own visibility.

Associated types have an implicit `Sized` requirement, unless the declaration
uses `?Sized`. Definitions must satisfy declared builtin and user-trait bounds,
including parameterized and inherited bounds. Associated definitions and
projection-bearing function signatures and stored field declarations are checked
even when not used. This does not mean arbitrary uninstantiated generic bodies
are universally checked; see the boundaries below.

Methods are checked against the trait's normalized parameter and return types.
`Self::Item` works in explicit implementations and inherited default methods.
Trait/method generic parameters are renamed independently of caller parameters;
renaming does not rewrite local variable names, fields or string literals.

## Paths, selection and identities

The canonical identity is `<Owner as DeclaringTrait<Args>>::Item`. Trait arguments
and the self type are part of the key; two traits with an item named `Item` do not
share either a definition or a memo entry.

`T::Item` is shorthand when the declaration environment provides an unambiguous
bound. `Self::Item` resolves using the surrounding trait/implementation context.
Applied supertraits participate in shorthand lookup. An explicit qualified path
names the trait that actually declares the item; it cannot silently skip an
intermediate projection or substitute another trait having the same member name.
Nested projections use explicit qualified syntax, such as
`<<T as Source>::Item as Other>::Output`.

Generic owners, blanket/structural implementations, transparent aliases,
parameterized traits, where predicates and generic forwarding implementations use
the existing structural implementation resolver. Concrete projections in impl
heads and trait arguments are normalized and reindexed before overlap checks.
This includes forward source-order dependencies between projected impl heads.
Symbolic impl-head equations are deliberately not solved by guessing a type.

Definition-local names are resolved **before** caller substitutions. This avoids
capturing unrelated caller modules or type binders. Alias expansion recovers the
caller's selected-implementation context without changing the alias's namespace.
Nominal fields, enum payloads, function signatures and aggregate constant values
all use this declaration-first normalization.

## Symbolic evidence and inference

The type of an associated output does not identify its implementing input. For
example, seeing an `i32` value does not justify inferring the `T` in
`fn take<T: Source>(x: T::Item)`, even if the current program happens to have only
one `Source` implementation with `Item = i32`.

`ProjectionInference` records deferred equalities. Ordinary structural positions
supply type evidence, then pending projections are normalized and checked again.
Evidence can come from later arguments, a declared result type or a function
pointer signature. Unresolved inputs produce `E0282`, rather than being inverted
through the implementation registry.

Pure literal trees can wait for independent owner evidence, so a later argument
can establish that an earlier unsuffixed literal is a `u8`. Calls, bindings,
captures, moves and loans are not reordered; emitted runtime argument and field
evaluation order remains the original source order. Delayed failures preserve
field-specific diagnostic spans and messages. Ferrite's existing strict literal
range checks still apply.

A symbolic associated origin retains the method evidence afforded by its declared
bounds, but this does not import those traits into lexical scope. Unlike a bare
generic parameter, a projection needs the method-providing trait in scope even
when a where clause explicitly repeats its bound. Qualified trait calls remain
available without an import.
An inherent method available only on a particular concrete substitution cannot
replace the trait method selected by generic code. Origins are propagated through
generic helper results and trait method results; the latter use the **trait
contract**, not a concrete spelling chosen by one explicit implementation.

## Normalization, isolation and budgets

`AssociatedTypeResolver` belongs to one symbol index. It retains symbolic
projections until a concrete implementation is selected, or until the current
implementation's definition can be used while checking its own contract.
Only successful concrete normalizations enter its positive memo. Symbolic proofs
are never authorized by a previous concrete result.

The complete query, including implementation applicability, is guarded against
recursion and dependency cycles. Failed queries release their active guards.
The current limits are 100,000 normalization requests, 64 active expansions,
2,048 memo entries and 4,000,000 accounted memo characters; individual projection
keys/results also have bounded sizes. Deferred inference is bounded separately.
These are compiler resource limits, not assertions about rustc's acceptance limits.

Cached type queries include declaration context. The semantic query cache also
tracks trait/type edits. Dedicated tests replay actual `SemanticQueryCache`
entries, require positive cache hits, change types and bounds, then verify failure
recovery. Deep-frozen source ASTs remain unchanged. Type symbols have source spans
and appear in compiler artifacts, but associated definitions do not become runtime
functions or globals.

After specialization, executable MIR layout types are concrete. JSON-round-tripped
MIR, generated JavaScript and the checked WebAssembly host ABI keep their existing
value representations. This feature introduces no new runtime opcode and no
unchecked reflection path. The artifact exposes normalization counters in
`sem.associatedTypes`.

## Current boundaries

This increment does **not** implement generic associated types (GATs), associated
equality/bound arguments such as `Source<Item = i32>` or `Source<Item: Copy>`,
conditional associated-item `where` clauses, or symbolic associated projection
equations in impl heads. Those valid Rust continuations receive explicit Ferrite
unsupported-feature diagnostics; their tests are not misreported as native Rust
compile-fail conformance. Associated type defaults and inherent associated types
are rejected rather than presented as stable Rust features.

Generic bodies still use the existing monomorphized body checker. Declaration
well-formedness and preserved method-bound origins are not a full universal
parametric proof of every generic body under every substitution. General
bidirectional expression inference also remains incomplete; postponing literal
trees does not implement inference for arbitrary context-sensitive expressions.

Full lifetime/NLL analysis, higher-ranked bounds, complete trait coherence and
projection-equation solving, user macros, async lowering, full standard-library
semantics and browser-native ABI/object-code generation remain separate work.
Native Cargo projects continue to use an installed Rust toolchain.

## Validation and reproducibility

```sh
node --test tests/associated-types.test.js
npm test
npm run check
npm run test:ui:types
npm run test:language
```

The dedicated suite executes each accepted fixture with optimization off/on
through all three backends, including JSON-round-tripped MIR. It also covers
compile failures, resource limits, source immutability, cache replay, runtime
artifact isolation and explicit unsupported-feature boundaries.

The shared language corpus adds 71 execution fixtures and 40 compile-fail fixtures.
It passes identical source to native rustc, edition 2024, at native optimization
levels 0 and 3. A separate strict-literal diagnostic test is retained outside this
hard-error corpus: rustc treats literal overflow as a configurable lint, while
Ferrite uses its existing `E_LITERAL` diagnostic. The shared harness is unchanged.

`npm run test:language -- --browser-only` runs browser backends without a native
oracle, and always records `nativeValidated: false`. It does not establish native
Rust compatibility. This continuation's development environment lacked `rustc`;
its native validation attempt failed explicitly instead of silently downgrading
to browser-only mode. Run the native gate in the unchanged repository CI before
merging this continuation.

The UI history tests also await the existing cooperative debugger's completion
event rather than assuming that Continue finishes within one CPU timeslice. An
additional regression checks yielding, staged-state isolation and exactly one
commit. No runtime scheduling or assertion semantics were weakened.

References: [Rust Reference: associated items](https://doc.rust-lang.org/reference/items/associated-items.html),
[qualified paths](https://doc.rust-lang.org/reference/paths.html#qualified-paths),
[rustc literal-overflow lint](https://doc.rust-lang.org/rustc/lints/listing/deny-by-default.html#overflowing-literals).

## Native method-scope regression

The initial native differential run rejected a program accepted by the browser
compiler: an associated-type bound had incorrectly granted lexical trait scope.
The original source is retained as an E0599 compile-fail regression alongside
accepted imported and qualified-call variants. Additional native probes cover
explicit projection bounds, concrete where clauses, generic parameter bounds,
supertrait evidence, and protection against concrete inherent-method leakage.
Method selection keeps the original symbolic evidence separate from lexical
visibility and from the concrete implementation used for code generation.
