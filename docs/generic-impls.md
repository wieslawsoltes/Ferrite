# Generic inherent implementations

The browser compiler retains implementation parameters and predicates separately
from method parameters. It resolves a concrete owner, structurally selects its
implementation, and sends the resulting signature through the same checked
monomorphization, ownership, MIR, JavaScript and host-assisted WebAssembly path
used by ordinary functions. Installed Cargo/rustc remains the full native toolchain.

## Construction, methods and specialization

```rust
struct Cell<T>(T);

impl<T> Cell<T> {
    fn new(value: T) -> Self { Self(value) }
    fn into(self) -> T { self.0 }
    fn map<U>(self, value: U) -> Cell<U> { Cell(value) }
}

impl<T: Copy> Cell<T> {
    fn get(&self) -> T { self.0 }
    fn replace(&mut self, value: T) -> T {
        let old = self.0;
        self.0 = value;
        old
    }
}

fn main() {
    let mut cell = Cell::<u32>::new(7);
    let old = cell.replace(9);
    println!("{} {}", old, cell.get());
    let wide = cell.map::<u64>(4294967296);
    println!("{}", wide.into());
}
```

`Cell::<T>::map::<U>` has two argument lists. Owner arguments never consume
method parameters or get silently replaced by a later argument. Owner arguments
can be inferred from ordinary arguments, a result annotation or a function-pointer
signature when the supported unification rules determine them. Methods support
`self`, `&self` and `&mut self`, definition-site aliases/imports, qualified owners,
`Self(...)`, `Self { ... }` and `Self::Variant` in construction and patterns.
Generic const methods use the existing checked evaluator and its execution budgets.

A temporary receiver is evaluated once, materialized, then borrowed before other
arguments are evaluated. An existing receiver is typed once; chained calls do not
reprocess already transformed HIR. Mutability and whole-local ownership checks
still apply. This is not Rust's full autoderef/autoref or two-phase borrowing model.

```rust
struct Cell<T>(T);
impl<T> Cell<T> {
    fn new(value: T) -> Self { Self(value) }
}
const MAKE: fn(u32) -> Cell<u32> = Cell::<u32>::new;

fn main() {
    let make: fn(bool) -> Cell<bool> = Cell::new;
    println!("{} {}", MAKE(42).0, make(true).0);
}
```

Function items retain specialization identity. Pointer coercions, direct calls
and indirect calls use the existing callable signature verifier. Addresses in
constants are permitted; invoking a pointer during constant evaluation is not.

## Selection, overlap and declaration bounds

An analysis-local owner/member index narrows the candidate set before structural
matching. Head variables are alpha-renamed per declaration. Matching includes
nested nominals, references, tuples, fixed arrays and function-pointer types;
repeated variables must agree and an occurs check rejects recursive equations.
`Cell<&mut T>` is not matched as `Cell<&T>` by an expression coercion.

Disjoint concrete heads can have the same method name. Inherent definitions with
structurally unifiable heads and the same name are rejected before either is
called. This is deliberately conservative: this implementation does not prove
that arbitrary trait predicates make two otherwise overlapping heads disjoint.
Inherent candidates take precedence over the existing concrete-trait lookup;
multiple applicable candidates otherwise produce a diagnostic. Lookup checks
privacy at every use, not just when building a cache.

Unused inherent declarations are checked for duplicate or unconstrained type
parameters, target kind/crate/arity, receiver type, unknown signature types,
placeholders and nominal well-formedness. For example, `struct C<T: Copy>(T)`
requires `impl<T: Copy> C<T>`, not `impl<T> C<T>`. Merely appearing in a constrained
nominal does not establish its trait bounds. `ImplObligations` checks the supported
bounds using declared assumptions, builtin supertrait implications and structural
rules; it does not implement a general Rust trait solver. Obligations have explicit
visit/depth limits and no result crosses a compilation revision.

## Caches and performance evidence

Indexes never modify cached AST/HIR or declaration templates. Each specialization
gets its own concrete `Self`; body, signature, bound, visibility, configuration
and source-location edits retain the existing query invalidation rules. Regression
tests compare matching against exact substitution, exercise the occurs check,
verify old snapshots remain unchanged and prove unrelated owners are excluded
from candidate scans. The functional compiler result exposes
`sem.implementations` (`implementations`, `lookups`, `candidatesExamined`).

The index avoids a full-declaration scan per method lookup; this is not a claim
of an end-to-end speedup. Use the paired benchmark to measure lookup time on a
specific host. It compares the same resolver with indexed versus exhaustive
candidate enumeration and asserts identical target/mapping results.

```sh
node --test tests/generic-impls.test.js tests/generic-impl-index.test.js
node tools/language-conformance.mjs --output artifacts/language/conformance.json
node tools/benchmark-impls.mjs --iterations 5 --output artifacts/performance/impls.json
npm run build:workers
npm run build:sdk
npm run check
npm test
```

The language corpus runs positive and compile-fail fixtures on the browser
backends and, when required, installed rustc in edition 2024 at optimization
levels 0/3. A browser-only run is explicitly marked `nativeValidated: false`.
Full repository validation additionally exercises native Cargo, the HTTP IDE,
agent/ncurses workflows, SDK types and independent offline UI exports.

## Remaining compatibility work

Generic method bodies still use Ferrite's existing **monomorphized checking**:
this increment does not prove an unused generic body is valid for every type
satisfying its bounds. General parametric body checking and a complete trait solver
are separate work. Generic trait implementations currently report
`F_GENERIC_TRAIT_IMPL`; reference-carrying generic method results report
`F_IMPL_REFERENCE` until interprocedural loan tracking is available. Owned values,
Copy projections and scalar stores through supported mutable receivers work.

Associated types/constants, const/lifetime impl parameters, full trait scope and
coherence, higher-ranked/variance/lifetime solving, associated-type inference,
projection-sensitive moves/NLL, two-phase borrows, multi-step custom Deref,
user-defined Drop, procedural/declarative user macros, general async lowering,
native ABI/layout/code generation and complete standard-library semantics are not
introduced here. The new runtime path does not simulate unsupported native Rust.
