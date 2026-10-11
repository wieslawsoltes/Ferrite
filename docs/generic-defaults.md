# Default generic type parameters

The browser compiler supports trailing default **type** parameters on structs,
enums, free type aliases and declared traits. Defaults integrate with the existing
semantic checker, projection resolver, constructor inference and concrete MIR
layouts. Browser compilation does not invoke native rustc.

```rust
trait Combine<Rhs = Self> {
    fn combine(self, other: Rhs) -> i32;
}

struct Value;

impl Combine for Value {
    fn combine(self, other: Self) -> i32 {
        7
    }
}

fn apply<T: Combine>(a: T, b: T) -> i32 {
    a.combine(b)
}

fn main() {
    println!("{}", apply(Value, Value));
}
```

The default in `T: Combine` means `Combine<T>`. An explicitly written
`Combine<Self>` inside an implementation still refers to that implementation's
lexical `Self`. Nested bounds such as `Source<Item: Combine>` use the associated
projection as the default's subject, not the containing source type.

## Omission is not inference

In a type annotation, `struct Pair<T, U = T>(T, U)` makes `Pair<u8>` equivalent to
`Pair<u8, u8>`. Likewise a fully omitted defaulted annotation `Value` can denote
`Value<u8>` when its declaration is `struct Value<T = u8>(T)`.

A bare constructor or associated-function expression leaves all parameters open
for ordinary inference. `Value(300)` and `Value::<>(300)` infer `Value<i32>`;
the declaration's `u8` default is not a numeric fallback. A partial nonempty
constructor turbofish fills only the omitted suffix. `Pair::<u8>(7, 8)` therefore
uses the dependent default `U = T`.

Explicit placeholders retain their identities. For example:

```rust
struct Pair<T, U = T>(T, U);

fn main() {
    let pair = Pair::<_>(7, 8u8);
    let first: u8 = pair.0;
    println!("{} {}", first, pair.1);
}
```

The constructor constraint `U = T` must not become two unrelated underscores.
The dedicated, constructor-local structural unifier has alpha-renamed variables
and an occurs check. Side-effect-free literal trees can receive contextual types
after suffixed evidence is available; source evaluation order, moves, calls and
loans are not reordered. Explicit arguments and expected result types must agree.
Projected defaults are normalized in the forward direction from independently
known inputs; associated outputs never guess an implementing type.

## Declaration checking and name resolution

Templates resolve names in their declaration module before simultaneous
substitution. An import or same-named alias at the use site cannot change a
default's meaning. Prior parameters are in scope; the current and later
parameters are not. A nominal declaration cannot use `Self` in a default.
Qualified projections such as `<T as Source>::Item` are supported; shorthand
`T::Item` in this default-parameter scope is rejected, including when nested in
another qualified type.

Unused defaults are checked for unknown types, invalid placeholders, misplaced
`impl Trait`, cycles, concrete well-formedness and concrete generic/where-clause
obligations. A concrete `String` default cannot satisfy `Copy`. Prior symbolic
parameters stay symbolic during definition checking, even if they also have
defaults; the substituted obligations are checked at use. Free-alias parameter
bounds retain Rust's existing non-enforcement semantics.

Private names introduced by defaults are checked at their syntactic use site.
Explicit replacement arguments do not need access to an unused private default.
The default's lexical template and canonical caller types are never reinterpreted
in one another's namespaces. This is not a claim of complete cross-crate privacy
analysis for every pre-existing inferred or associated type flow.

## Isolation and bounded work

`GenericDefaults` owns declaration metadata, template expansion guards and query,
depth and type-size budgets. Each default is checked once at definition, rather
than repeatedly expanding every remaining suffix. Failed expansions unwind their
guards. Template cycles and associated-projection cycles have separate owners:
normalizing a caller's projection can legitimately reuse a default template.

A nominal spelling can hide a projected default. Type-query cache keys therefore
retain declaration identity even when that spelling contains no `::`. Equality
assumptions from one generic function cannot authorize a cached result in another.
Default edits participate in the existing full declaration-environment key used
by the real HIR query cache. Neither source ASTs nor cached HIR are modified.

MIR, JavaScript and host-assisted WebAssembly receive the same fully instantiated
types. No runtime default evaluator, extra unchecked opcode or native compiler
fallback is added. The standalone SDK and browser workers are regenerated from
these same sources.

## Current boundaries

This continuation uses the compiler's existing supported generic type grammar.
Relaxed generic parameter bounds (`T: ?Sized`) are supported by the
[relaxed Sized continuation](relaxed-sized.md), including unsized defaults.
Lifetime/const parameters and their defaults, higher-ranked constraints, GAT
defaults, and standard-library declarations not supplied by Ferrite are separate work. Function and impl *binder* defaults are
rejected; a concrete impl target may use defaults from its nominal declaration.

Dependent inference holes in **type paths** and associated-function owner paths
remain explicitly unsupported (`F_GENERIC_DEFAULT_INFERENCE`). For example,
`let p: Pair<_> = ...` needs a persistent type-path equation, unlike the supported
constructor expression `Pair::<_>(...)`. A hole is never silently treated as a
default or duplicated into independent unknowns.

Whole-body backward type inference is not added. A later `let x: u8 = value.field`
does not retroactively retype an earlier unconstrained alias constructor's integer
literal. Supply a suffix or contextual annotation at construction. Existing
reference formatting, temporary-borrow promotion, universal parametric-body
checking, complete lifetime/NLL, opaque types, macros, async, standard-library and
native-code-generation limits also remain.

## Reproducible evidence

```sh
node --test tests/generic-defaults.test.js
npm test
npm run check
npm run test:language
```

The dedicated accepted cases run with optimization off/on through generated
JavaScript, host-assisted Wasm and JSON-round-tripped MIR. Additional tests cover
frozen ASTs, declaration-local hidden projections, actual HIR-cache replay,
default edits/failure recovery, visibility, source ordering, budget cleanup and
absence of unresolved equations from executable MIR.

The same source cases are part of the native differential corpus: Rust edition
2024, native optimization 0/3, overflow checks enabled. `RUSTC` can select an
installed compiler. A native run must record `nativeValidated: true`;
`--browser-only` is explicitly not native evidence. Normal CI retains all native
Cargo/UI and HTTP/browser/IDE/agent/designer/debugger/export/SSR/React gates.

Native discovery also exercised known unsupported combinations. Those are not
counted as passing corpus entries. The three syntax-only rejected declarations
(function defaults, impl binder defaults and nontrailing defaults) are tested
separately because their explicit diagnostics are not the corpus's numeric
Rust-style error-code contract.

References: [Rust Reference, generic parameters](https://doc.rust-lang.org/reference/items/generics.html)
and [traits](https://doc.rust-lang.org/reference/items/traits.html).
