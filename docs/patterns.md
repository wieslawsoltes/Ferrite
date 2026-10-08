# Pattern typing, coverage and lowering

The parser now accepts named-field struct patterns (including shorthand and `..`),
parenthesized or-patterns and match alternatives, integer/character ranges, and
`let ... else` in addition to tuple, enum, literal, binding and wildcard patterns.

`PatternAnalyzer` assigns projection types and local identities. All alternatives
share the same binding slots and must bind the same names with the same types and
mutability. Duplicate names within a pattern are errors. Constant names and enum
constructors are resolved before treating a name as a new binding.

`PatternCoverage` specializes a matrix of patterns against type constructors.
For enums it recursively examines payloads; for tuples and structs it examines
products. Integer domains are partitioned at literal/range boundaries without
enumerating every integer. Character domains exclude surrogate code points.
Guards do not contribute coverage. A missing case is reported as a witness such
as `Option::Some(false)`, not as a fabricated proof. Work is bounded to avoid
unbounded analysis on recursive or pathological input; exceeding the budget
produces a diagnostic.

`PatternLowerer` emits existing typed MIR operations, not JavaScript-only special
cases. Alternative tests and enum payload access short-circuit. Bindings merge
into the same storage, and `let-else` failure branches retain function returns,
loop breaks and continues. The MIR VM, generated JavaScript and WebAssembly
backend run the same tests in both optimized and unoptimized modes.

The Compiler explorer's **Pattern coverage** view shows actual proof states,
witnesses and original-source links. Per-instance query caching replays proof
reports along with the typed function.

## Remaining pattern boundaries

Reference binding modes (`ref`, `ref mut`), `@` bindings, slice patterns, open-ended
ranges and arbitrary computed constant patterns are not implemented here.
Ownership remains the existing conservative whole-local model, not a new proof
of rustc-equivalent field-sensitive move checking or NLL.

Language references:
- https://doc.rust-lang.org/reference/patterns.html
- https://doc.rust-lang.org/reference/statements.html#let-statements

Regression cases: `tests/pattern-matrix.test.js`, plus browser acceptance of the
new examples and coverage view.
