# Enum discriminants and integer casts

The browser compiler evaluates the logical numeric discriminant of every enum
variant, independently of the runtime tag used by pattern matching. An implicit
first variant is zero; each following implicit variant increments its predecessor.
An explicit constant expression sets the value from which increments resume.

```rust
#[repr(i16)]
#[derive(Copy, Clone)]
enum Status {
    Pending = -3,
    Running,
    Done = 40,
    Archived,
}

const ARCHIVED: i16 = Status::Archived as i16;

fn main() {
    let status = Status::Running;
    println!("{} {}", status as i32, ARCHIVED);
}
```

This prints `-2 41`. Casts use Rust integer truncation/sign rules rather than
checked arithmetic: `Status::Pending as u8` is `253`. Numeric values remain exact
BigInts internally, including explicitly represented `i128`/`u128` extremes.

## Constant dependencies and diagnostics

Discriminants use the production typed MIR constant evaluator, not an independent
expression interpreter. They can call supported const functions, refer to constants,
and cast another eligible enum value. Direct unit-variant casts create type-system constant dependencies, even in an
unexecuted branch. A direct forward cast can resolve another variant without
materializing the enum. By contrast, a local, argument or temporary holding an
enum by value also requires its layout, which depends on all its discriminants.
Materializing an enum while computing its own discriminant therefore produces
`E0391`; a direct, acyclic cast does not invent that layout dependency.

Every variant is validated before runtime emission, even in unused declarations.
Duplicate values produce `E0081`, implicit overflow `E0370`, explicit out-of-range
values `E0080`, dependency cycles `E0391`, and invalid representation combinations
`E0566`. The existing constant instruction, expression-count, recursion and value
budgets apply. Nested evaluator work contributes to the compilation-wide budget.
Long implicit runs resolve iteratively rather than consuming one JS stack frame
per variant. Configuration filtering precedes numbering.

## Representation and cast eligibility

Unit-only enums support explicit discriminants without an integer representation.
Other enum forms require a primitive integer representation for explicit values.
Fieldless tuple/record variants can be cast when only unit variants carry explicit
discriminants. Enums containing stored payload fields cannot be cast to integers,
and casts of enums implementing `Drop` are rejected. Existing move and borrowed
value checks continue to run; deriving Copy is not implied by fieldlessness.

The browser target uses **32-bit `isize` and `usize`**, including the default
logical enum discriminant type. Use a fixed-width repr for wider values.
`repr(Rust)`, `repr(C)` and supported combinations with primitive integer reprs
are accepted for logical semantics; **no native C/Rust memory layout, niche
optimization, unsafe pointer access, or `mem::discriminant` API is implied**.
Unsupported repr hints are explicit `F_ENUM_REPR` diagnostics.

## Backend and cache invariants

The `discriminant` MIR instruction reads an enum tag through a validated decimal
value table, then an ordinary integer cast performs the requested conversion.
Production MIR rejects missing/unresolved tables. Only temporary compiler-owned
constant evaluation uses a lazy resolver, which cannot leak into emitted code.

MIR interpretation, generated JavaScript and host-assisted WebAssembly share the
same checked runtime operation. JavaScript hoists immutable tables to module scope
and deduplicates equal tables; casts in loops do not allocate the whole enum table.
Each runtime caches the parsed numeric value per table/tag but rechecks the encoded
value on every call, so edited or removed externally supplied metadata cannot
reuse stale values. Tables and cached syntax remain independent per compilation.

Changing explicit values, reprs, cfg conditions or const-function bodies invalidates
the corresponding semantic queries. Warm-query replay receives this compilation's
resolved table without modifying the stored typed snapshot. Serialized MIR and
source-linked instruction mappings retain the same values and diagnostics.

The prefix-operator/cast precedence fix in this increment ensures that `*e as i32`
means `(*e) as i32`, not `*(e as i32)`.

## Reproduce

```sh
node --test tests/enum-discriminants.test.js
npm run test:language
npm run check
node tools/benchmark-discriminants.mjs --iterations 7
```

The language runner requires installed rustc and compares optimization off/on for
MIR, JavaScript and Wasm against native opt-levels 0/3 with overflow checking.
Its separate `--browser-only` mode explicitly reports `nativeValidated: false`.
The paired benchmark isolates table hoisting in generated-JavaScript execution;
it is not a historical or whole-toolchain speed comparison.

Reference semantics: <https://doc.rust-lang.org/reference/items/enumerations.html>.
General lifetimes/NLL, projection-sensitive moves, user macros/async, native
code generation and full library/trait semantics are separate compiler work.
