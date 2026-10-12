# Projected pattern ownership and guarded moves

By-value patterns now use typed projection plans instead of consuming their whole
scrutinee. The same plans feed local bindings, let-else, if-let, while-let,
condition chains and match arms. This extends [ownership places](ownership-places.md)
and [returned-reference contracts](borrow-contracts.md); it is not complete Rust
region inference or a memory-safety certification.

```rust
struct Packet {
    name: String,
    payload: String,
    sequence: u32,
}

fn main() {
    let packet = Packet {
        name: String::from("header"),
        payload: String::from("body"),
        sequence: 42,
    };
    let Packet {
        name,
        ..
    } = packet;
    match packet {
        Packet {
            payload,
            sequence: 42,
            ..
        } if payload.len() > 0 => {
            println!("{} {} {}", name, payload, packet.sequence);
        }
        _ => {}
    }
}
```

The example is also `examples/11-pattern-ownership.rs` and prints
`header body 42`. The first binding moves only `packet.name`. The match can inspect
`packet.sequence` and move `packet.payload` because its wildcard ignores the moved
name. Reading the whole packet or either moved field would be an error.

## Move plans and source evaluation

`PatternOwnership` builds an analyzer-local plan over typed bindings, tuple and
record fields, tuple structs, enum payloads, fixed array elements, array-rest
bindings, and `@`/or-patterns. Wildcards do not read or move a place. Literal/range
tests read their selected projections; enum patterns also inspect the discriminant.
A source already moved in its entirety can still be ignored by a wildcard-only
pattern. Side-effecting initializers and address/index expressions are nevertheless
evaluated exactly once.

Bindings use declaration-owned Copy evidence, not the accidental capabilities of
a concrete generic specialization. Copy fields can be read independently of moved
siblings. Each possibly moved projection joins the existing finite move state;
reinitialization clears only that place's moved descendants. Pattern element
projections have fixed array indices. Ordinary runtime indexing remains conservative
and cannot repair or read a partially moved array simply by spelling a constant.
Moves through borrowed storage or ordinary indexing are still rejected.

All pattern observations are checked before committing moves. This matters for
`whole @ (_, copy_field)`, which observes the Copy field before moving the owner.
Overlapping whole/part non-Copy bindings remain invalid. Or-patterns collect the
union of possible actions without constructing a Cartesian product of nested
alternatives; each possible source location must be valid.

The existing MIR pattern lowerer receives Copy annotations on all bindings, not
just condition-chain bindings, so copied aggregate fields have independent runtime
values. There is no new executable opcode, runtime lifetime interpreter, drop flag
ABI, or reliance on native rustc during browser compilation.

## Success, failure, guards and backedges

Failed pattern tests do not commit binding moves. Let-else evaluates its initializer
before the diverging alternative. Match-guard failure retains the guard's effects
on outer state without pretending that the candidate was moved. Successful arms
commit their selected moves; continuation joins and loop fixed points use the
existing ownership snapshots. A `continue` that bypasses reinitialization therefore
cannot make a moved binding available on the next iteration.

A match guard temporarily freezes its bindings and the source projections required
by its pattern. A candidate cannot be moved, assigned, or mutably borrowed before
arm selection, even if declared `mut`. Borrowing a disjoint wildcard field remains
possible. Guard locks are removed on every exit, including diagnostic failures;
ordinary loans created by the guard remain subject to normal ownership dataflow.

Direct-reference pattern bindings attach tracked referent origins and loan ancestry.
Expiration happens before evaluating the scrutinee, not again in the gap between a
returned reference value and its receiving binding. This preserves loans forwarded
through a nested block's local handle in if-let, while-let, match and condition
chains. Their last reachable uses still release the loans. Local referents cannot
be made to outlive their scope through these constructs.

## Work bounds and inspection

Plans are memoized only within an ownership analyzer. Source ASTs are never mutated;
typed HIR metadata participates in the existing real semantic-query cache. Plan
visits and repeated binding work are charged against a 65,536-unit pattern budget;
projection depth is capped at 64, alongside the existing place and flow budgets.
Exhaustion yields `F_OWNERSHIP_LIMIT`, and a failed ownership result cannot be
published as a successful cache entry. The readonly SDK `OwnershipReport.patternWork`
and inspector expose the charged work. Pattern move events retain original spans
and function-local place IDs.

## Boundaries

This increment implements by-value pattern moves, not source `ref`/`ref mut`
patterns or implicit reference-pattern ergonomics. General aggregate-reference
storage, independent lifetime relationships, closures returning references, complete
NLL/region/outlives/HRTB/drop checking, and universal checking of uninstantiated
generic bodies remain incomplete. A direct reference extracted from an aggregate
without a tracked field origin fails with `F_PATTERN_REFERENCE`; a native-valid
example is tested separately rather than mislabeled native compile-fail. Other
pre-existing unsupported reference-carrying paths are not all rejected.

Closure capture precision still follows the existing conservative capture model.
Destructuring assignment has its own existing analysis; this change does not claim
new precision for every assignment pattern. Custom Drop and observable destruction
order, unsafe provenance, pinning, async suspension ownership, native ABI behavior
and full language/standard-library parity remain separate work.

## Validation

```sh
node --test tests/pattern-ownership.test.js
node --test --test-concurrency=4 tests/*.test.js
npm run check
npm run test:ui:types
npm run test:language
```

Accepted fixtures run with optimization off/on through JSON-round-tripped MIR,
JavaScript and host-assisted WebAssembly. The same source corpus runs against
native Rust edition 2024, optimization levels 0/3, with overflow checks on.
Projection matrices cover moves versus reads/loans, guard mutation, loop
reinitialization and or-pattern joins. Other tests cover AST immutability, actual
query replay/invalidation, readonly metadata and budget-failure recovery. These are
finite differential checks, not proof of complete checker equivalence.

References: [Rust move paths](https://rustc-dev-guide.rust-lang.org/borrow-check/moves-and-initialization/move-paths.html),
[Rust patterns](https://doc.rust-lang.org/reference/patterns.html),
and [match guards](https://doc.rust-lang.org/reference/expressions/match-expr.html#match-guards).
