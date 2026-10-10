# Generic implementations of declared traits

The browser compiler supports type-parameterized implementation targets for
**declared, non-parameterized user traits**. Generic trait declarations such as
`trait Convert<T>` and associated types remain separate compiler work. This
feature is shared by the checked MIR VM, generated JavaScript, the host-assisted
WebAssembly backend, workers and embedded SDK; it does not add another runtime.

```rust
trait Value {
    fn value(&self) -> i32;
    fn doubled(&self) -> i32 { self.value() + self.value() }
}
struct Cell<T>(T, i32);
impl<T: Copy> Value for Cell<T> {
    fn value(&self) -> i32 { self.1 }
}
fn read<T: Value>(value: T) -> i32 { value.doubled() }
fn main() {
    println!("{}", read(Cell(true, 21)));
}
```

Generic nominal, tuple and fixed-array targets, primitive targets and blanket
`impl<T> Trait for T` targets use structural matching with independent binder
identities. Impl bounds and where predicates are recursive obligations. A
currently active obligation is not considered proven merely because it occurs
again. Ground successful proofs and top-level failures are memoized per analysis;
conditional declaration proofs instead use their own explicit assumption scope.

## Contracts and dispatch

An impl must provide all required methods and cannot add methods absent from the
trait. Parameter counts, generic arity, receiver shape and normalized signatures
are checked before invocation. Method type parameters are alpha-renamed when
comparing signatures; trait and impl binders with the same spelling are distinct.
An implementation cannot impose stricter method bounds than its declaration.
Omitted method bounds retain the trait contract when a method is instantiated.

Trait `Self` is not implicitly `Sized`. Default bodies with by-value `Self`
parameters or results require `where Self: Sized`; required methods can keep
abstract by-value signatures. Checked `Sized` obligations apply to supported
concrete primitives and aggregates. A user trait named `Sized` is not the
builtin marker, and the `core::marker::Sized` path retains that distinction.
This does not add dynamically sized value layout or `?Sized` parameters.

Defaults are cloned into implementation-specific function descriptors. Default
bodies retain the trait's lexical module, specialize `Self`, and resolve declared
trait methods before similarly named inherent methods on the concrete type.
Implementation and default-method type parameters cannot accidentally capture
one another: default type syntax and generic associated-path prefixes are
alpha-renamed, not string literals or local value/field names. Substituted
primitive/structural implementors support associated calls and method pointers. Ordinary external calls retain inherent-method precedence.

```rust
trait Identity {
    fn identity<T>(&self, value: T) -> T {
        let result: T = value;
        result
    }
}
struct Cell<T>(T);
impl<T> Identity for Cell<T> {}
fn main() {
    println!("{}", Cell(true).identity::<i32>(7));
}
```

User trait identities are canonical declaration paths. Two traits named `Mark`
in different modules do not satisfy one another's bounds. Ownership and builtin
operations use builtin `Copy`/`Clone` checks, not a user trait that happens to use
that name. Trait methods must be in scope (including renamed imports); owner
paths and first-class method values cannot bypass this requirement. Defaults can
be taken as checked function pointers using the callable-item implementation.

Overlapping implementations of the same trait are rejected, including marker
traits without methods. Different traits may share method names; importing both
requires disambiguation. The current owner-path surface reports ambiguity rather
than silently choosing a target. Full `<Type as Trait>::method` syntax is not
implemented in this increment. Foreign-trait/foreign-owner combinations are
rejected. The implementation does not assume that arbitrary where predicates
prove two overlapping heads are disjoint.

## Resource limits, caching and tests

Proof caches retain at most 4,096 entries and four million key characters, with
32,768-character per-entry admission. Ground proof recursion is bounded to 64
active goals, 200,000 queries per compilation, and overlap validation to 200,000
pairs. Existing symbolic declaration proof depth/visit budgets remain enforced.
Resource exhaustion raises a compiler diagnostic, not native execution or an
unbounded recursion. `sem.traitResolution` exposes proof/cache/candidate counts.

Trait proof candidates are indexed by trait identity and structural owner, with
an additional blanket bucket. Indexes are rebuilt for each analysis. Trait
contracts, default bodies, implementation predicates, imports, cfg decisions and
source relocation participate in existing immutable compiler-query invalidation.

```sh
node --test tests/generic-traits.test.js tests/generic-trait-index.test.js
node tools/language-conformance.mjs --output artifacts/language/conformance.json
npm run build:workers
npm run build:sdk
npm run check
npm test
```

The differential runner executes unchanged reviewed fixtures through installed
rustc, edition 2024, opt-levels 0 and 3 with overflow checks, and all browser
backends with optimization disabled/enabled. `--browser-only` explicitly reports
that native validation was not performed.

## Remaining boundaries

This does not establish full Rust trait or language parity. Generic bodies use
the existing monomorphized checker, not universal parametric body checking.
Parameterized traits/supertraits, associated types/constants, HRTBs, dyn objects,
negative impls/specialization, full orphan-rule fundamental-type reasoning and
projection-sensitive ownership/lifetimes remain outside this surface. Standard
library trait definitions are not imported: explicit manual implementations of
those traits report `F_TRAIT_EXTERNAL`; this does not disable existing builtin
bounds or derives. Generic reference-carrying method results retain
`F_IMPL_REFERENCE`. User macros, async lowering, native layout/codegen and full
standard-library parity remain separate from the browser compiler.

### Intrinsic identities and aggregate well-formedness

Declaration obligations canonicalize builtin Copy, Clone, Sized and related
traits independently from user traits of the same name. Intrinsic Copy and Clone
entail Sized; a user trait named Clone does not. Array element types (including
zero-length arrays), non-tail tuple members, and supported nominal/Vec type
arguments must be Sized even in unused required-method signatures. The default
method checker still permits an unbounded direct Self result in a required
method, but not a body that materializes that result without a Sized proof.

The trait-hardening fixtures also retain qualified-path binder-freshening
regressions from the earlier implementation without changing caller-private
definition-site substitutions or generic closure result inference.
