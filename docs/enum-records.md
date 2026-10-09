# Named enum variants

The browser compiler accepts enum variants with named fields. They reuse the
existing enum value representation: a variant tag and a declaration-ordered
payload vector. They do not introduce JavaScript object-shaped enum storage.

```rust
enum Event<T> {
    Point { x: T, y: T },
    End {},
}

fn main() {
    let event: Event<i32> = Event::Point { y: 6, x: 7 };
    match event {
        Event::Point { x, y } => println!("{}", x * y),
        Event::End {} => println!("end"),
    }
}
```

Initializers execute in their **written order**, not declaration order. Typed
HIR retains the source-to-payload permutation; MIR evaluates each initializer
once and only then assembles the positional payload. Bounds, arity, field names,
duplicates, required fields and variant form are checked before code generation.
An enum's fields inherit its visibility; explicit field visibility is rejected.
Configuration filtering updates the member list and payload ordinals together.

Patterns support shorthand, renamed bindings, nesting, `..`, alternatives, guards,
`if let`, `while let`, and `let-else`. Coverage considers the named fields and emits
named witnesses for missing cases. Ignored fields do not emit payload projections.
Read the existing ownership documentation: this is not full reference-binding or
projection-sensitive partial-move analysis.

## Assignment targets

Record variants in a single-variant enum can destructure into existing places:

```rust
enum Coordinates { XY { x: i32, y: i32 } }

fn main() {
    let mut x = 1;
    let mut y = 2;
    Coordinates::XY { y: x, x: y } = Coordinates::XY { x: 20, y: 10 };
    println!("{} {}", x, y);
}
```

All selected RHS values are captured before any destination changes. Destination
places are then evaluated and written in source order, including repeated places
and side-effecting indices. A failing RHS executes no destination effects; a later
failing destination does not roll back earlier stores. Multi-variant enum targets
are rejected as refutable. Unsupported reference-carrying transfers still produce
`F_ASSIGN_REFERENCE` rather than dropping the loan information.

The same construction, pattern and assignment paths work with constant evaluation,
MIR interpretation, generated JavaScript and host-assisted WebAssembly. No native
Rust ABI layout or discriminant representation is implied.

## Wide values and caches

Per-compilation WeakMap indexes resolve named fields to declaration ordinals. They
are not written into AST/HIR/query snapshots. Field order, name, type, privacy and
cfg edits invalidate the appropriate semantic queries; unchanged callers still
replay immutable snapshots.

WebAssembly aggregates above 256 operands use a one-parameter host import that
reads the already evaluated operands from the current activation frame. The host
copies these values into a new payload array and never retains the mutable frame.
This avoids the JavaScript WebAssembly API's function-parameter limit for wide
enums, records, tuples and array literals. It is not a freestanding Wasm ABI, and
does not lift limits on user function parameter counts or other host operations.

Tests exercise 1,024-field values, threshold boundaries, nested calls, loops, Copy
isolation, source spans, step-count equivalence and invalid frame metadata. Wide
aggregate support is validated in the local three-backend suite, not by claiming
that every engine-specific resource limit has been removed.

## Reproduce

```sh
node --test tests/enum-records*.test.js tests/wasm-wide-aggregates.test.js
npm run test:language
npm run check
```

`npm run test:language` requires installed rustc. The explicitly separate
`--browser-only` mode reports `nativeValidated: false`. The differential fixtures
include named records, unit/empty tuple/empty record brace syntax, alias/import
resolution, generic context, evaluation order, cfg ordinals and diagnostic cases.
First-class function/constructor values, delayed initialization, user-defined Drop,
full lifetime/trait solving and general macro/async lowering remain other work.
