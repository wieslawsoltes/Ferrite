# Rust 2024 condition chains

Ferrite's browser compiler accepts ordered `if` and `while` conditions that mix
boolean expressions with `let PATTERN = EXPRESSION`, joined by top-level `&&`.
Bindings are visible to later conditions and the successful body, but not to the
alternative or the enclosing scope. Each operand is evaluated once, left to
right, and the first false condition or failed pattern selects the failure edge.

```rust
fn main() {
    let mut values = vec![1, 2, 3, 4];
    while let Some(value) = values.pop() && value > 1 {
        if let doubled = value * 2 && doubled > 4 {
            println!("{} {}", value, doubled);
        }
    }
}
```

Output is `4 8` followed by `3 6`, each on its own line. This exact example is a
shared browser/native differential fixture, not a documentation-only sketch.

## Syntax and checking

A chain may start or end with either a pattern or a boolean. Patterns reuse the
existing checked constructor, tuple, record, array/rest, scalar/range, `@` and
alternative-pattern machinery. Shadowing takes effect only after the scrutinee
has been checked. Generic and associated-type declaration evidence follows the
new bindings and expression results; a concrete `Copy` specialization does not
grant an undeclared generic copying privilege.

Parentheses delimit ordinary expressions. `(a || b) && let x = value` is allowed;
unparenthesized `||` in a chain and parenthesized `let` expressions are rejected.
An assignment used to produce a condition needs an ordinary boolean block such
as `{ count += 1; count < 4 }`. Single-pattern `if let`/`while let` and boolean-only
conditions retain their existing AST forms. Chains are represented by explicit
`ifChain`/`whileChain` nodes containing an ordered operand list, not by boolean
values whose local variables escape.

In a while condition, `break` and `continue` must be explicitly labelled when
targeting that loop; an inner loop can still have its own unlabeled exits. Both
headers and bodies participate in ordinary return/label checking. Unselected
operands are type checked even though they are not executed.

## MIR, constants, and runtime values

Lowering reuses ordinary pattern tests, reads, copies, writes and branches. There
is one failure block and one lowering of the alternative, so the control-flow
graph grows linearly with the operand list rather than duplicating an else tree.
No runtime condition interpreter, unchecked opcode, JavaScript `eval`, or native
compiler dependency is introduced into browser compilation.

Scrutinee places are read without an eager aggregate copy. Successful `Copy`
bindings are materialized through the existing typed copy operation; non-Copy
bindings move only on the successful pattern edge. Wildcards and Copy-only
projections do not consume the entire scrutinee. Constants use the existing
checked MIR evaluator, including short-circuiting, arithmetic failure detection
and evaluation budgets. MIR, generated JavaScript, host-assisted WebAssembly,
compiler workers and the standalone SDK use the same lowered control flow.

## Ownership domain and resource limits

The condition-flow service snapshots moved locals, tracked reference origins and
loans. A failure edge retains earlier operand effects, but never imports effects
from a skipped operand. Pattern-local loans end on failure; references that
actually escape to outer locals retain their loans. Returning a reference to a
condition-local referent is rejected. Rust's checking continuation for an
irrefutable chain alternative also retains the successful binding's move effects.

While headers are analyzed to a bounded fixed point over the initial entry and
body/header continue edges. Break exits are joined separately. This catches a
move that becomes invalid on a later iteration and permits reinitialization
before a repeated read. Replay does not duplicate ownership events or append
spurious exits to an enclosing loop. Per-instance `ownership.conditions` reports
charged work and loop iterations.

The default limits are 256 operands per chain, 64 nested ownership analyses,
128 header iterations, and 1,048,576 charged ownership operations per function
instance. The operation budget charges state sizes, not just iteration count.
Reference-storage inspection has its own depth and type-count guards. This is a
finite place/loan domain: state snapshot work also depends on the number of
tracked places, borrower identities and loan ancestors, and is not claimed to be linear in source size. Limit
failures are diagnostics; failed ownership results are not cached as success.

## Explicit compatibility boundaries

This is not a full Rust borrow checker or an edition implementation. The browser
parser accepts the syntax in its supported dialect; per-crate edition gating was
not added. Differential fixtures explicitly use native Rust edition 2024.

The shared checker now uses [projection-sensitive explicit field places and CFG local
liveness](ownership-places.md). Pattern scrutinee moves remain conservative. It is
not general NLL, reference/slice pattern match ergonomics,
full lifetime/HRTB analysis, or observable `Drop`/temporary-destruction ordering.
The syntax feature does not add custom destructors or a native memory ABI.

Direct reference bindings/results must have tracked local or parameter origins.
Destructuring/storing reference-carrying aggregates and interprocedural
reference-return origins are not implemented by this pass. Those cases fail with
`F_CONDITION_REFERENCE` rather than silently treating an unknown origin as safe;
capability-boundary tests are kept out of the native compile-fail corpus. A
reference result whose referent is known to be condition-local fails with E0597.

General backward integer inference remains separate work. For example, use
`3usize` rather than `3` in an irrefutable condition binding whose type can only
be inferred from a later array-length result. Native Rust can infer that case;
Ferrite's existing eager local inference cannot. A dedicated boundary regression
records the difference instead of counting it as a native rejection.

Universal checking of unused generic bodies, full trait/GAT/const-generic solving,
macro/async/std parity and native ABI/code generation remain outside this increment.

## Reproduce validation

```sh
node --test tests/let-chains.test.js
npm run check
npm test
npm run test:language
```

The dedicated suite exercises optimized/unoptimized JavaScript, WebAssembly and
JSON-round-tripped MIR, immutable ASTs, semantic/ownership/MIR query replay,
malformed injected conditions, scope/copy/loan regressions, fixed-point recovery,
budget failures, and linear CFG growth. The same reviewed source fixtures enter
the unchanged native differential runner at opt levels 0 and 3 with overflow
checks enabled. `--browser-only` explicitly does not establish native evidence.
Normal full CI additionally retains native variance, Cargo/UI and HTTP/browser,
agent/terminal, designer/debugger, exports, SSR/hydration and React gates.

References: [Rust Reference: if expressions](https://doc.rust-lang.org/reference/expressions/if-expr.html)
and [Rust 2024 Edition Guide: let chains](https://doc.rust-lang.org/edition-guide/rust-2024/let-chains.html).
