# Tuple and unit structs, constructor patterns and assignees

Ferrite's browser compiler represents record, tuple and unit structs as distinct
**nominal types**, sharing one typed field-aggregate HIR/MIR representation. A tuple
struct is not a structural tuple, even when its fields have the same types. The
native Cargo backend remains an independent installed-rustc path.

## Supported construction and patterns

```rust
struct Pair<T>(T, T);
struct Ready;
struct Empty();

fn main() {
    let Pair(a, b) = Pair::<u8>(3, 7);
    let Pair(.., last) = Pair(11, 13);
    let Ready = Ready;
    let Empty() = Empty();
    println!("{} {} {}", a, b, last);
}
```

Positional fields are exposed as `.0`, `.1`, and so on, including nested field
projection and stores through supported mutable references. Numeric record
syntax (`Pair { 0: a, 1: b }`) works for construction, patterns and assignees.
Tuple-pattern rests, nested/or patterns, exhaustive-match checks, let-else,
if-let, for patterns, Copy values and checked const evaluation use the same
existing compiler passes. Generic arguments can be explicit or inferred from
supported surrounding/result and field contexts; struct bounds and where
predicates are checked. Generic impl/lifetime solving is not generalized here.

`struct Ready;` and `struct Empty();` are different declaration forms. `Ready`
is a value and cannot be called; `Empty()` must be called and cannot be matched
as a bare unit constructor. Empty braces are also supported where Rust's struct
expression/pattern grammar permits them.

Tuple/unit constructors occupy the **value namespace**. A `use` alias can rename
a constructor; a type alias does not create a new value constructor. For example,
`type Alias = Pair<u8>;` permits `Alias { 0: 1, 1: 2 }`, but not `Alias(1, 2)`.
Concrete inherent methods can construct their owner using `Self(...)`.

Private fields are checked for construction, projection, mutation and pattern
access. Positional tuple constructors require access to every field; a numeric
record pattern may omit inaccessible fields using `..`. Generic and stored-field
validation also runs for unused declarations: unknown/placeholder field types,
wrong generic arity, duplicate members/parameters and unused type parameters do
not silently pass because no function constructs the type. This is not a full
Rust well-formedness, layout, variance or lifetime proof.

Configuration filtering happens before declaration indexing. Disabled tuple
fields are removed and remaining ordinal fields are renumbered. The indexes
belong to a single compilation and never live in syntax/HIR snapshots.

## Constructor-shaped assignment

```rust
struct Pair<T>(T, T);
enum Message { Value(i32) }

fn main() {
    let mut left = 1;
    let mut right = 2;
    Pair(left, right) = Pair(right, left);

    let mut value = 0;
    Message::Value(value) = Message::Value(42);
    println!("{} {} {}", left, right, value);
}
```

These are assignee expressions, not function calls or new pattern bindings.
Existing locals/fields/indexed places receive selected values. Tuple structs
support nesting, explicit type arguments, `_` and `..`. Tuple-enum assignees
must be irrefutable: this implementation accepts a sole variant and rejects a
multi-variant enum even when the RHS spelling appears to select that variant.

The RHS is evaluated exactly once. Selected payloads are extracted into
independent temporaries before the first destination store. Copy aggregates
are detached before destination aliasing can mutate them. Destination places
are then evaluated and written **left to right**, once each. A later destination
can observe an earlier store, and a later panic does not roll back that store.
An RHS panic prevents all destination effects. Mutable closure captures and
constant evaluation use the same assignee-aware analysis and lowering.

Tuple-struct assignees lower to existing aggregate `get`/`read`/`write` MIR.
Tuple-enum assignees add existing `payload` projections, not a new backend ABI.
The MIR VM, generated JavaScript and host-assisted WebAssembly execute those
same instructions. Debug/source mappings retain the original target spans.

## Performance and cache isolation

The declaration index keeps weak side tables for fields, variants and immutable
tuple constructor descriptors. Each field/variant table costs O(width) once,
then expected O(1) per lookup rather than scanning all preceding fields on every
projection. Pattern specialization likewise indexes named fields per analysis.
No process-global caches or source-AST mutations are introduced. Visibility is
still checked at each use, including cache hits from a different module.

The regression suite checks lookup identity against the independent linear
algorithm, first-match behavior, no repeated member enumeration, AST immutability,
visibility/type/form changes, cfg-dependent ordinals, query replay, source
relocation and wide records. The benchmark alternates measurement order and
verifies identical MIR, JavaScript and Wasm bytes for the two lookup algorithms.
End-to-end compile measurements can be dominated by other passes; no general
compiler speedup is inferred from a lookup microbenchmark.

## Reproducible validation

```sh
node --test tests/nominal-constructors.test.js tests/nominal-index.test.js
npm run check
npm test
npm run test:language
node tools/benchmark-nominal.mjs --iterations 25 --output artifacts/performance/nominal.json
```

The shared constructor fixtures compare optimized/unoptimized MIR, JavaScript
and WebAssembly with installed Rust edition 2024, native optimization levels 0
and 3, and checked overflow. They include positive results, compile rejections,
and stdout before panic. Native validation fails when rustc is missing; the
explicit `--browser-only` mode does not claim native validation. Full CI also
runs the existing HTTP IDE, native Cargo/repository and agent/terminal suites.
The IDE sample **Nominal values · tuple/unit structs & assignments** demonstrates
constructors, constants, a generic swap and a single-variant enum assignment.

## Explicit remaining boundaries

First-class constructor function values and function-pointer coercion produce
`F_CONSTRUCTOR_VALUE`; call supported constructors directly. Enum record variants,
full generic impls, reference/slice binding modes, delayed initialization,
projection-sensitive partial moves/NLL, temporary-reference promotion,
user-defined Drop and complete trait/standard-library semantics remain outside
this increment. Reference-carrying destructuring transfers retain the explicit
`F_ASSIGN_REFERENCE` guard; scalar stores through mutable references work.
Layout attributes/native ABI, size/alignment, zero-sized native storage and
serialization wire compatibility are not defined by the JavaScript aggregate
representation. Unsupported features must not be advertised as rustc parity.

References: [struct items](https://doc.rust-lang.org/reference/items/structs.html),
[struct expressions](https://doc.rust-lang.org/reference/expressions/struct-expr.html),
[tuple-struct patterns](https://doc.rust-lang.org/reference/patterns.html#tuple-struct-patterns),
[assignment expressions](https://doc.rust-lang.org/reference/expressions/operator-expr.html#assignment-expressions).
