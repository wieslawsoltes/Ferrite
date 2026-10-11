# Associated constants

The browser compiler supports inherent and declared-trait associated constants,
including parameterized trait applications and generic implementing types. The
same checked values feed MIR interpretation, generated JavaScript and
host-assisted WebAssembly. Browser compilation does not delegate to rustc.

```rust
trait Limit<T> {
    const VALUE: T;
    const DOUBLED: (T, T) = (Self::VALUE, Self::VALUE);
}

struct Widget;

impl Limit<i32> for Widget {
    const VALUE: i32 = 21;
}

impl Widget {
    const NAME: &str = "widget";
}

fn main() {
    let pair = <Widget as Limit<i32>>::DOUBLED;
    println!("{} {} {}", Widget::NAME, pair.0, pair.1);
}
```

## Resolution and checking

A trait may declare a required constant without an initializer or provide a
default. Every inherent/implementation constant requires an initializer. Trait
contracts check item kind, substituted type, required items, extra items,
duplicate value-namespace names and visibility. Constants and functions occupy
one associated value namespace; a constant is not an instance method.

Lookup supports `Owner::NAME`, `Owner::<T>::NAME`, `Self::NAME`, declared
`T: Trait`/`where` bounds, and `<Owner as Trait<Args>>::NAME`. Generic owners,
transparent aliases, blanket implementations, applied supertraits and renamed
imports use the structural implementation resolver. Trait arguments participate
in selection and evaluation identity. Inherent members take normal precedence;
generic bound origins and inherited default bodies retain their trait identities.
An explicit implementation is not a trait default: its concrete `Self` still has
ordinary inherent-member precedence. Ambiguous applications require an explicit
qualified path. An unresolved intermediate projection cannot be skipped to look
up just its final identifier.

Expected result types can infer an otherwise unspecified implementing type, but
cannot overwrite explicit arguments. Constants do not accept item-level type
arguments. A `fn(...) -> ...` constant is callable through the existing checked
function-pointer path; a scalar constant is not callable.

## Evaluation and isolation

Evaluation is lazy at use and after specialization. Unused arithmetic failures
and cyclic value dependencies are not executed. Used initializers are checked
with the typed MIR evaluator: no JavaScript `eval`, separate expression
interpreter, runtime constant thunk or new unchecked opcode is introduced.
Integer overflow, division by zero, dependency cycles and the existing
instruction/expression/recursion/value budgets remain enforced.

Unused **concrete implementation** initializers are type-, const-legality- and
ownership-checked without executing their values. This check owns a separate
analyzer, including its callable/closure, obligation and instance tables. Its
type-only references cannot reach the query cache, debugger, emitted MIR or
runtime. This separation also prevents checking function addresses and
noncapturing closures from creating dangling identities in the actual program.

Source AST constants remain `const` items. Declaration indexing creates internal
zero-argument const-body descriptors for specialization; these are neither Rust
function items nor emitted runtime functions. Checked values are materialized
into the existing constant/aggregate representation. Owned aggregate uses remain
independent, and taking a function address does not execute that function.

Inline `const` blocks and repeat-array counts preserve enclosing type parameters,
`Self` and trait context without capturing runtime locals. Concrete associated
constants work in array lengths and scalar/range patterns. Length/type caches
include the owner and trait context, preventing identically spelled `Self::N`
from crossing implementation boundaries. Constructor pattern type arguments are
retained and checked rather than ignored. Generic associated constant patterns
remain rejected with `E0158`.

## Current boundaries

This increment does not implement associated types, associated type bindings,
generic associated types, trait type-parameter defaults, general const generics,
reference promotion, aggregate structural-constant patterns, trait-object
constants, or const trait methods. Constants support the evaluator's existing
materializable values; they do not introduce arbitrary compile-time allocation
or references into temporary const storage.

Generic bodies still use Ferrite's monomorphized body checker. A generic
initializer or uninstantiated trait default is not universally type-checked under
all symbolic substitutions merely by adding this feature. Full parametric-body,
lifetime/NLL, standard-library and native-codegen parity remain separate work.
Native Cargo continues to use the installed Rust toolchain for full native Rust.

## Validation

```sh
node --test tests/associated-constants.test.js
npm test
npm run check
npm run test:language
```

The dedicated tests execute accepted fixtures with optimization off/on through
all three browser backends, including JSON-round-tripped MIR. They also exercise
rejected programs, lazy definition checking, warm query-cache invalidation,
source-AST preservation, artifact isolation and bounded evaluation. The shared
language corpus supplies the **same source** to installed rustc, edition 2024,
with native optimization levels 0 and 3 and overflow checks enabled. The explicit
`--browser-only` mode does not constitute native validation. Normal CI also
retains the IDE, SDK, worker, UI/debugger, native Cargo and browser acceptance gates.

Reference: [Rust Reference — associated constants](https://doc.rust-lang.org/reference/items/associated-items.html#associated-constants).
