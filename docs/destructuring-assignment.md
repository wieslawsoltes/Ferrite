# Destructuring assignment

Ferrite supports nested tuple, fixed-array and record-struct **assignee expressions**. These update existing storage; unlike `let` patterns they do not declare bindings or introduce scopes.

```rust
struct Point { x: i32, y: i32 }

fn main() {
    let mut a = 1;
    let mut b = 2;
    (a, b) = (b, a);
    [a, .., b] = [3, 4, 5];
    Point { y: a, x: b } = Point { x: 7, y: 9 };
    println!("{} {}", a, b); // 9 7
}
```

Destinations may be mutable variables, fields, indices, or dereferenced mutable references. `_` ignores a value; `..` skips tuple/array elements or omitted record fields. Neither introduces a binding. Record shorthand is supported, as are record aliases, explicit generic arguments and constraints derived from destination types. Destructuring is a unit-valued expression and requires `=`, not compound assignment.

## Evaluation and lowering

`AssigneeAnalyzer` builds typed annotations on the original target AST. It validates existing binding identity, mutability, nominal record identity, field names, tuple/array arity and at most one rest per sequence. It does not reinterpret value expressions as binding patterns or apply reference match ergonomics.

`AssigneeLowerer` evaluates the right-hand expression once and extracts every selected value into MIR temporaries **before** any destination is evaluated. Copy leaf aggregates are independently copied. The stores then execute left to right in assignee order. Each index/dereference expression is evaluated exactly once, immediately before its store. Later destination expressions can observe earlier stores:

```rust
let mut i = 0usize;
let mut values = [0, 0];
(i, values[i]) = (1, 9); // values == [0, 9]
```

This is not an atomic transaction: a panic at a later destination preserves earlier stores. A panic or return while computing the RHS suppresses all destination effects. Divergent destination indices also suppress their store and any later store. The regression suite compares observable output before panic, not just the error code.

The lowerer uses existing `read`, `get`, `write` and literal instructions. MIR interpretation, generated JavaScript, host-assisted WebAssembly and checked constant evaluation consequently use the same lowering. Wildcards/rest create no per-element operations. A 100,000-element array with only its first and last elements selected requires two projections, not 100,000.

## Ownership and current boundaries

A wildcard or Copy-only projection does not consume an existing non-Copy container. Constructing a temporary aggregate still evaluates and consumes its operands normally. Moving a non-Copy projection retains Ferrite's conservative whole-local move model: projection-sensitive partial-move tracking is not implemented. Direct local stores may reinitialize moved locals; writing one field of an already moved aggregate cannot revive it.

Scalar stores **through** mutable references work. Transferring reference-carrying values **as** tuple/array/record assignment leaves is explicitly diagnosed as `F_ASSIGN_REFERENCE`, including references nested in aggregates or captured by closures. Such transfers need projection-sensitive loan/provenance tracking; silently accepting them would miss lifetime and aliasing errors. Static string values (`&str`) remain supported. Use supported individual assignments or the installed native Cargo backend for unsupported forms.

Tuple-struct/enum-constructor assignees, destructuring slices, `ref` binding patterns, user-defined `Drop` semantics and general backwards type inference are not added here. Locals must already be declared/initialized under the existing browser compiler rules. Explicit numeric annotations may be necessary where the compiler would otherwise default an earlier local to `i32`. The feature does not claim complete Rust pattern, lifetime or standard-library parity.

Assignee nesting is bounded at 128 and assignee nodes at 16,384. Source spans are retained on each leaf store; cached typed trees are immutable snapshots with fresh copies for readers.

## Validation

```sh
node --test tests/destructuring-assignment.test.js
npm run test:language           # requires installed rustc; tests debug and optimized native code
npm run check
npm test
```

Shared fixtures execute on optimized/unoptimized MIR, JavaScript and WebAssembly and compare with Rust edition 2024 at native optimization levels 0 and 3. Compiler-specific unsupported-feature and resource-budget tests are separate from Rust compile-fail tests, so a deliberately unsupported valid Rust program is not misrepresented as a Rust rejection.

References: [Rust assignment expressions](https://doc.rust-lang.org/reference/expressions/operator-expr.html#assignment-expressions), [underscore expressions](https://doc.rust-lang.org/reference/expressions/underscore-expr.html).

General range **values** such as `(..)` and `..=1` are valid Rust but remain
outside this browser subset (`F_RANGE_VALUE`); they are not treated as invalid
Rust in the native compile-fail fixtures. Bare `.. = value` is instead an
invalid standalone assignment target. Sequence rests inside an assignee remain
supported.

A bare never-typed index (`array[return value]`) is rejected rather than
assuming that `!` implements indexing. A conditional index with a typed
nondiverging branch can still return early, and that control flow is preserved.
