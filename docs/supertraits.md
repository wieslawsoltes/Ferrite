# Supertrait obligations and inherited method scope

Declared, non-parameterized user traits can require other traits using a colon
list, `where Self: ...`, or both. Supertrait requirements are transitive and are
checked on every implementation, including unused generic implementations.

```rust
trait Value {
    fn value(&self) -> i32;
}
trait Counter: Value {
    fn step(&mut self);
    fn advance(&mut self) -> i32 {
        self.step();
        self.value()
    }
}
struct Cell(i32);
impl Value for Cell {
    fn value(&self) -> i32 { self.0 }
}
impl Counter for Cell {
    fn step(&mut self) { self.0 += 1; }
}
fn next<T: Counter>(value: &mut T) -> i32 { value.advance() }
fn main() {
    let mut value = Cell(41);
    println!("{}", next(&mut value));
}
```

The example prints `42`. Its inherited calls use the same production method
specialization, checked MIR, generated JavaScript and host-assisted WebAssembly
as ordinary user methods. Receiver reborrowing is described separately in
[Method receiver reborrows](receiver-reborrows.md).

## Canonical requirements, not copied implementations

The graph uses canonical declaration identities after resolving module paths,
renamed imports and visibility. A trait bound makes its own and its ancestors'
methods available to the corresponding type parameter. It does not globally
import those methods for arbitrary concrete receivers. A default body resolves
its trait/supertrait methods before same-named concrete inherent methods.
Distinct applicable trait methods remain ambiguous; a diamond reaching the same
ancestor does not duplicate the method. Ancestor methods must be implemented in
the ancestor impl, not repeated as extra methods in a child impl.

Both method-contract checking and declaration well-formedness expand assumptions
transitively. For example, `T: Child` may prove a required `T: Parent`, but the
reverse implication is not invented. Implementation candidates still need their
own declared prerequisites. The compiler rejects missing parent implementations
with `E0277`, unresolved trait names with `E0405`, private paths with `E0603`, and
self/mutual/transitive graph cycles with `E0391` before any trait is instantiated.

Intrinsic bounds use identities separate from user traits with the same final
name. An actual `Sized` ancestor permits an owned default `Self` result; a user
trait named `Sized` does not. An actual `Copy` ancestor entails intrinsic `Clone`
and `Sized` without turning an unrelated user `Copy` trait into a derive.

## Bounded graph and cache

`TraitHierarchy` belongs to one semantic analysis. It stores deduplicated,
immutable direct-parent arrays in side tables, not on reusable syntax. Cycle
validation uses an explicit DFS stack. Lazy ancestor closures also use an
explicit stack and deduplicate visited identities. Warm membership checks use a
Set rather than walking the ancestor graph again. Visibility is checked when
resolving the declarations; the cache is not shared across different analyses.

Defaults permit 200,000 declared edges, 200,000 visits per closure and four
million total closure visits per hierarchy. The LRU retains at most 4,096
closures and four million key/ancestor characters. Invalid limits fail early;
resource exhaustion raises `F_TRAIT_HIERARCHY_LIMIT` rather than overflowing the
host stack. Symbolic assumption expansion retains its own bounded obligation
budget. `traitResolution.hierarchy` reports cache entries, characters, hits,
edges and traversal counts. The character budget is a retention metric, not an
exact JavaScript heap-byte measurement.

Tests compare closure results with an independent traversal on generated DAGs,
exercise 3,000-trait depth, detect cycles, check LRU and work budgets, and verify
immutable source/query snapshots and invalidation after a required-bound edit.

```sh
node --test tests/supertraits.test.js
node tools/language-conformance.mjs --browser-only
node tools/language-conformance.mjs
node tools/benchmark-supertraits.mjs --iterations 9 --output artifacts/performance/supertraits.json
```

The benchmark alternates cached and exhaustive query measurements and verifies
every Boolean query result. It separately reports cold graph construction plus
queries. Parsing and symbol indexing are outside those timings; warm runs also
exclude graph construction and closure warmup. These are membership-query
measurements, not historical or end-to-end compiler speedups.

## Current boundaries and validation meaning

Generic trait declarations (`Trait<T>`), associated types/constants, general
trait-level predicates on subjects other than `Self`, callable supertraits,
trait objects, fully qualified `<T as Trait>` paths, HRTBs and negative
impls/specialization remain separate work. The parser/semantic analyzer reports
explicit boundary diagnostics for unsupported declarations instead of ignoring
them. Generic bodies retain the monomorphized checking model rather than full
parametric body checking. Borrow-region/projection analysis and native ABI/layout
are not provided by the supertrait graph.

A browser-only run tests optimized/unoptimized MIR, JavaScript and WebAssembly;
it does not establish rustc agreement. The installed-rustc runner is the native
conformance gate. New fixtures and this example have local browser validation;
they still require that native gate and the full HTTP acceptance workflow before
this follow-on scope should be merged.

Language reference: https://doc.rust-lang.org/reference/items/traits.html#supertraits
