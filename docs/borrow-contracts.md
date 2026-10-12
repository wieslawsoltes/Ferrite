# Direct-reference call contracts

The ownership checker retains the origins and loan ancestry of a direct reference
returned by an ordinary function, user method, generic specialization, function
item, or checked function pointer. It also inserts reference-shaped argument
reborrows. These checks extend [projected places and CFG local liveness](ownership-places.md);
they do not delegate browser checking to rustc or introduce runtime lifetime opcodes.

```rust
fn retain<T>(value: &T) -> &T {
    value
}

struct Counter {
    value: i32,
}

impl Counter {
    fn borrow(&mut self) -> &mut i32 {
        &mut self.value
    }
}

fn add(value: &mut i32, amount: i32) {
    *value += amount;
}

fn main() {
    let mut counter = Counter {
        value: 20,
    };
    let reference = counter.borrow();
    add(reference, *reference + 2);
    println!("{}", *retain(&counter.value));
}
```

This complete example is also `examples/10-borrow-contracts.rs`. It prints `42`.
The returned mutable reference borrows the receiver until its last reachable use.
`add` reborrows the handle rather than moving it. The implicit reborrow reserves
before reading the second argument and activates immediately before the call.

## Signature-owned dependencies

For a reference-shaped return, an elided reference receiver selects the receiver's
input lifetime. Otherwise the signature needs one unambiguous input lifetime.
Nested reference occurrences are counted separately; function-pointer signatures
introduce their own lifetime binders and are not counted as outer input lifetimes.
Aliases are resolved with symbolic generic parameters, without accidentally
normalizing projections using one concrete specialization.

The callee must return a tracked origin allowed by its signature. The caller does
not inspect the callee's body to shorten or narrow the loan. Thus a method returning
`&mut self.left` still borrows its whole receiver; a direct call receiving
`&mut object.left` can retain that explicit field place and coexist with a loan of
`object.right`. A receiver method cannot return an unrelated reference argument
merely because a particular call passes references with compatible concrete types.

A generic identity or selector returning its input type carries that type's
reference lifetime when specialized to a direct reference. All independently
supplied arguments of that symbolic type constrain the result, including inputs
that carry it through `&T`, `&&T`, or mutable reference storage. For example,
`choose<T: Copy>(x: T, y: &T) -> T` retains both the lifetime of `x` and the lifetime
of the value stored behind `y`, regardless of whether its body returns `x` or
`*y`. The temporary borrow of the pointer storage itself can end at the call.
An unrelated reference-shaped input does not acquire the generic type's lifetime.
Such generic arguments still move mutable reference handles; only explicitly
reference-shaped formals authorize an implicit reborrow. Nested/aggregate generic
output contracts are not inferred by reversing the concrete result type.

The contract is attached before checking a function body, so recursive calls use
the same signature rules. Actual callee instance contracts are attached to typed
HIR calls and included in their ownership query keys. A signature edit cannot
reuse a borrow result from the old declaration. Source ASTs remain unchanged.

## Call loans and two-phase arguments

Every argument is evaluated once in the existing language evaluation order.
Argument loans remain protected through nested argument evaluation and activation.
At call completion, non-result temporary loans are released. Result-dependent
loans and their ancestry move into the surrounding call scope or attach to the
receiving local. Copies, assignments, branch results, loop/label exits, and let
chains retain these origins through the existing forward ownership state.

An explicitly reference-shaped parameter can reborrow a mutable input handle.
A shared formal receives a shared reference, not the mutable specialization that
happened to arrive. Compiler-inserted mutable argument reborrows reserve and then
activate; a source `&mut` expression remains immediately exclusive. Consequently
`add(reference, *reference + 2)` is supported, but writing
`add(&mut *reference, *reference + 2)` does not opt into reservation semantics.
Conflicting shared arguments still prevent activation.

Returning a reference from a call never gives it a fresh lifetime independent of
its inputs. A block-local input cannot escape through a forwarding helper, an
outer assignment, a loop result, or a conditional result. A live returned loan
prevents overlapping mutation even if the original reference handle has no future
source-level use. Last reachable uses release loans, including between iterations.

## Borrowed reference storage

A borrowed reference cell is different from its referent. For `let y = &x`, a live
borrow of `y` must retain the loan of `x` even if the checker sees no future direct
use of the name `y`. Before expiring loans, the checker traces reachable storage
origins and ancestor loans to a fixed point. It indexes storage by allocation root
to avoid comparing each loan with every unrelated reference local.

Reading a Copy reference through `&&T` preserves the inner reference's origin and
authority, rather than retaining only the outer storage borrow. After that read,
the storage may be reassigned when no longer borrowed, but the original referent
remains protected while the copied reference is used. This covers nested direct
reference locals; it is not general aggregate reference dataflow.

## Work bounds and inspection

Signature traversal has a 64-level nesting limit and 65,536 work-unit limit;
resource exhaustion produces `F_OWNERSHIP_LIMIT`. Loan dependency work is charged
to the existing projected-place budget. Failed analyses cannot publish successful
ownership query results. Tests lower the signature budgets, verify the failure,
then rerun using the same query cache after restoring the limits.

The readonly SDK `ReferenceContract` describes its schema version, `elided` or
`generic` dependency kind, zero-based parameter indices in `sources`, and result
mutability. An optional readonly `indirections` array specifies the number of
reference-storage dereferences for each corresponding source; it is omitted when
all depths are zero. An unsupported contract carries a diagnostic and never
produces a successful executable artifact. `OwnershipReport.referenceContract` is null when
no such contract is needed. Caller events include `retain returned reference`,
`reserve mutable argument`, `shared argument reborrow`, and `activate mutable
argument`, with original source spans and function-local place IDs.

Contracts are checker metadata. MIR verification, execution, JavaScript and
host-assisted WebAssembly use the existing borrowed-location representation;
no runtime equation interpreter, unverified opcode, or native ABI is added.

## Explicit compatibility boundaries

This is not universal region inference, complete rustc NLL, or a memory-safety
certification for arbitrary Rust. Explicit lifetime syntax, outlives relations,
higher-ranked regions, full declaration-wide lifetime checking, universal checking
of uninstantiated generic bodies, and subtyping among independent reference inputs
remain separate work. The generic identity rules do not prove every parametric
function valid for all possible substitutions.

Direct-reference returns need represented direct input origins. A reference
nested inside an aggregate input, a generic reference-carrying container, projected
associated output, or closure result may require an unimplemented contract and
is rejected with `F_BORROW_CONTRACT` or `F_BORROW_ORIGIN`. In particular, returning
`&T` while an additional input also constrains the references inside `T` requires
separate inner and outer result-region dataflow. Such contracts fail explicitly
rather than confusing an inner referent with the outer pointer-storage address;
this also rejects some valid native programs. Scalar substitutions do not need
these extra regions. Aggregate return carriers,
reference-valued fields, arbitrary mutation through reference storage, and all
pattern-bound references still need broader dataflow. Existing targeted boundary
checks remain, but not every unsupported carrier is diagnosed. Do not interpret
these checks as closing every pre-existing unsafe acceptance path.

`&str` uses the existing immutable string-value representation and is not treated
as a borrowed cell by this contract pass. Temporary reference promotion, complete
custom `Deref` coercions, every builtin fast path, destructor/drop liveness and
ordering, unsafe provenance, pinning, and async suspension borrowing are not added.
These boundaries also apply to function-pointer and closure integration. Native
valid but unsupported cases remain capability tests, never fake compile-fail
fixtures in the native differential corpus.

## Validation

```sh
node --test tests/borrow-contracts.test.js
node --test --test-concurrency=4 tests/*.test.js
npm run build:workers
npm run build:sdk
npm run check
npm run test:language
```

The shared sources run with browser optimization off/on through JavaScript,
host-assisted WebAssembly and interpreted MIR; dedicated tests serialize and
restore MIR before executing it. The same source corpus goes to installed rustc,
edition 2024, at native optimization levels 0 and 3 with overflow checks enabled.
`--browser-only` is explicitly not native validation. The nested-field matrix
covers shared/mutable returned loans for every pair of four scalar field paths.
A second matrix covers one, two, and three indirect generic input layers, both
callee selections, scope escape, mutation conflicts, last-use release, and
pointer-storage reassignment. Cases requiring unrepresented inner output regions
are separate capability tests, not falsely advertised native conformance cases.

Other tests cover frozen accepted/rejected ASTs, actual typed-HIR/ownership/MIR query
replay and invalidation, recursion, source-linked reports, resource recovery,
reference storage, loop backedges, and incompatible contracts. The normal PR CI
also retains the SDK declarations, deterministic bundles, native Cargo/UI, normal
HTTP/browser/IDE/agent/editor/designer/debugger/export/SSR/React gates.

References: [Rust lifetime elision](https://doc.rust-lang.org/nomicon/lifetime-elision.html),
[two-phase borrows](https://rustc-dev-guide.rust-lang.org/borrow_check/two_phase_borrows.html),
and [MIR borrow checking](https://rustc-dev-guide.rust-lang.org/borrow_check.html).
