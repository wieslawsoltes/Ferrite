# Ownership places, local liveness and explicit reborrows

Ferrite checks ownership over typed HIR before emitting MIR. This pass now uses
projection-sensitive places, a backward local-liveness graph and structured
forward dataflow. It is **not a complete implementation of rustc's borrow checker
or region inference**, and passing this checker is not a Rust memory-safety
certification. See the remaining boundaries below.

## Example

The parent mutable reference permits separate child loans of disjoint fields.
The child loans expire after their last reachable uses, allowing access through
the parent again. The example prints `42` on the MIR, JavaScript and host-assisted
WebAssembly backends.

```rust
struct Pair {
    left: i32,
    right: i32,
}

fn main() {
    let mut pair = Pair { left: 0, right: 0 };
    let parent = &mut pair;
    let left = &mut parent.left;
    let right = &mut parent.right;
    *left = 20;
    *right = 22;
    println!("{}", parent.left + parent.right);
}
```

## Places and partial initialization

Each function instance owns an interned place table. Local place IDs retain the
existing HIR slot numbers. Projections identify tuple positions and record fields;
index projections use a conservative dynamic-index marker. Reference parameters
have separate external pointee roots, so moving a reference handle does not mark
its referent as moved. Lifted closure reference fields also have distinct pointee
identities within their function instance.

Overlap is different from initialization containment. A move of `p.left` prevents
using that field or the whole `p`, but leaves `p.right` available. Assigning a new
`p.left` clears moved descendants of that field; it does not revive a moved parent.
Replacing `p` clears its descendants. Different fields are disjoint, including
fields following potentially equal indices. Indices themselves may alias even
when their source expressions are different constants. Non-Copy moves through
references or indexed collections remain errors.

This precision applies to explicit field places. General destructuring patterns
still use the existing conservative whole-scrutinee move handling; there is no
complete pattern move-path construction or drop-flag elaboration in this change.

## Control-flow local liveness

A separate graph models typed-HIR evaluation order, local definitions, reads,
branches, lazy boolean expressions and loop backedges. `break`, `continue` and
`return` have explicit successors. A predecessor-driven worklist solves backward
local liveness with dense bitsets before forward ownership checking begins.

Named loans use this graph rather than a source-offset last-use heuristic. A use
on a loop backedge keeps its loan live even when a later source position has been
visited. Conversely, a use confined to one alternative does not keep the loan
alive inside the other alternative. Assignment kills the destination's old local
value after the right-hand side and address operands have been evaluated.

The forward pass snapshots moved places, loan identities, referent origins and
reborrow authority for each alternative. Non-diverging alternatives are joined;
loops iterate over their initial state and reachable backedges, including explicit
`continue` edges, until the finite state stabilizes. Condition chains use the same
state domain. Replays do not duplicate ownership events or enclosing-loop exits.

These are local-use liveness and finite ownership-state fixed points, not a
solution of universal lifetime constraints. Temporary/call-frame lifetime
boundaries still use explicit call scopes and source spans where no named local
liveness applies. Scope-exit checks reject tracked local referents escaping through
block results and outer direct-reference locals.

## Reborrow authority

A loan has a stable source-site/place identity, a projected referent, mutability,
its borrowers and ancestor-loan IDs. Explicit `&*r`, `&mut *r` and field reborrows
can use an authorized parent without conflicting with that parent. Sibling or
child loans are not automatically authorized. Consequently, a live child loan
freezes overlapping parent access while disjoint children can coexist; the parent
becomes usable again when the child is no longer live.

Copying or transferring a tracked reference preserves its loan lineage, including
all live shared copies. Reassigning a reference detaches its old borrower identity.
Compiler-inserted two-phase method receivers and reference-shaped call arguments
retain reservation and activation checks. [Direct-reference call contracts](borrow-contracts.md)
retain selected input loans through function/method results. Explicit source mutable borrows are active immediately. Call argument
loans remain protected for the duration of the call, including nested calls.

## Work budgets, queries and inspection

The implementation does not annotate input ASTs. Place/liveness state belongs to
the function analysis; serializable ownership reports participate in the existing
semantic query cache. A failed analysis must not publish a successful cached result.
Tests cover frozen ASTs, actual query hits, invalidation and recovery after errors
or exhausted budgets.

The default place limits are 65,536 places, 64 projections per path and 4,194,304
charged comparison/projection work units. The liveness graph is limited to 65,536
nodes, 8,388,608 32-bit words of stored liveness, 16,777,216 work units and 256 levels
of expression nesting. Structured ownership uses the existing shared condition
state/work budgets, 64 nested control-flow analyses and at most 128 loop iterations.
These are resource limits, not a promise of a particular compilation time.

Reports expose `places`, `placeWork`, `liveness` graph/work counts, and source-linked
ownership `events`. Events keep their original `slot` and additionally contain a
`place` ID. IDs are function-instance-local and should not be treated as stable
across source edits. The optional existing `conditions` counters also include work
performed by ordinary structured forward flow. Runtime MIR operations and runtime
reference representation are unchanged by this analysis.

## Remaining boundaries

There is no full lifetime syntax/region constraint solver, universal generic-body
borrow checking, higher-ranked lifetime reasoning, complete outlives/drop checking,
Polonius implementation, or complete coercion/call-argument semantics. The
[call-contract continuation](borrow-contracts.md) adds reference-shaped argument
reborrows and signature-owned direct-reference results, not arbitrary region equations.
The analysis does not establish interprocedural alias relationships between
independently supplied reference parameters. General aggregate reference carriers,
reference-valued fields, interprocedural origins outside direct-reference contracts and
all pattern-bound references need further work. Existing targeted origin checks
remain in force, but not every unsupported reference-carrying path is diagnosed;
this pass must not be described as complete or sound for unrestricted Rust.

Custom `Drop`, observable temporary destruction order, precise destructor liveness,
move/drop flags, partial pattern moves, pinning, unsafe aliasing/provenance, async
suspension borrowing and a complete native ABI are not supplied by this increment.
The broader language, standard library, macro and native-code generation boundaries
also remain. Native-valid unsupported cases must stay separate from native
compile-fail conformance fixtures.

## Validation

`tests/ownership-places.test.js` exercises all accepted fixtures with optimization
on/off through JSON-round-tripped MIR, JavaScript and host-assisted WebAssembly.
Rejected fixtures are checked with both optimization settings. The same reviewed
Rust sources are included in `tests/fixtures/language-conformance.js`, so the normal
native conformance gate checks rustc acceptance/rejection and runtime output at
optimization levels 0 and 3 with overflow checks enabled. The generated nested-field
matrix covers every pair of four paths, shared/mutable loan modes and direct versus
parent-reborrow access. It is a finite differential suite, not a proof of complete
borrow-checker equivalence.
