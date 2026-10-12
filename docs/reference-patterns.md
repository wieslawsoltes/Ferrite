# Explicit reference patterns and projected loans

`ref name` and `ref mut name` bind references to the selected source place rather
than moving or copying its value. They compose with the existing projected-pattern
checker in local `let` and let-else bindings, if-let, while-let, let chains, and
match arms. This increment does not claim full Rust ownership, region inference,
or a memory-safety certification.

```rust
struct Packet {
    name: String,
    count: i32,
}

fn main() {
    let mut packet = Packet {
        name: String::from("packet"),
        count: 40,
    };
    let Packet {
        ref name,
        ref mut count,
    } = packet;
    *count += 2;
    println!("{} {}", *name, *count);

    let mut result = Some((1, 2));
    if let Some((ref mut left, ref right)) = result {
        *left += *right;
    }
    let Some((left, right)) = result else {
        return;
    };
    println!("{} {}", left, right);
}
```

The complete example is `examples/12-reference-patterns.rs`. Its output is:

```text
packet 42
3 2
```

The shared name loan and exclusive count loan are disjoint. The enum example
borrows its actual payload, writes through the selected field, ends both loans,
and then moves the payload into an ordinary by-value pattern.

## Matched types, binding types, and source addresses

Typed patterns retain the type being matched. Their local binding has the separate
reference type: matching an `i32` with `ref mut n` produces an `&mut i32` binding.
The binding itself is immutable; its referent is mutable. A mutable binding modifier
is distinct from mutable reference binding mode. Or-patterns must agree on binding
names, reference types, and binding modes. Constants cannot be shadowed by `ref`.
Declaration-owned Copy evidence follows the binding's reference type and preserves
the abstract pointee's original bounds; specializing a generic pointee to an
integer does not authorize an undeclared Copy operation.

A source address is evaluated once before tests and binding publication. Indexed
places retain the evaluated index, and dereferencing a computed reference first
evaluates its call and obtains its checked origins. Neither ownership analysis nor
lowering evaluates such calls twice or consumes an owned pointee to find its address.
A borrow of a Copy aggregate also uses original storage, not a cloned value.

Non-place scrutinees use compiler-owned temporary slots. Local reference patterns
can retain those slots for the enclosing block. Control-flow-local temporaries
cannot escape through match/condition results or outer references. These are
explicit local-storage rules, not general Rust constant promotion or drop checking.
Incoming AST fields cannot forge these temporary slots: address metadata is rebuilt
on the typed-HIR copy and only reused within its owning semantic analyzer.

## Loans, alternatives, guards, and captures

The existing projection plan now describes moves, observations, and reference
bindings. Ordinary Copy observations occur before new loans, allowing patterns such
as `ref mut whole @ (copied_integer, _)`. Moving an overlapping owned component
while borrowing it, or creating overlapping exclusive loans, is rejected even
when the reference binder has no later use. Disjoint field moves and loans compose.

Bindings publish ordinary scoped loans with their own IDs, projected roots,
source spans, borrower locals, and parent reborrow authority. Copies, function
results, loops, and last-use expiration reuse the existing ownership dataflow and
signature contracts. Returning a reference to a parameter projection is checked
against the function declaration; inspecting the implementation does not narrow
a caller's whole-input loan to a conveniently selected field.

Alternative choices are recorded without Cartesian expansion. Mutually exclusive
bindings of the same local may have several possible origins. Ordinary overlap
checks apply to actions that can coexist. Distinct exclusive binders whose origins
overlap only because alternatives swap their places require correlated origin
states; that native-valid case is explicitly rejected rather than given unsound
aliasing authority.

Guard bindings are established before the guard but remain frozen until the arm
is selected. Guards may read through a mutable reference binder but cannot move,
mutably reborrow, or mutate through it. Failed guards release candidate-local loans;
the existing guard locks still protect required source projections while permitting
unrelated sibling mutations. The successful bind phase reuses the same loan IDs.

Borrow-only patterns now request shared or mutable closure captures instead of
accidentally consuming the source and turning the closure into FnOnce. Patterns
that also contain by-value bindings retain the existing conservative capture policy.

## Shared storage does not confer exclusive access

The continuation also fixes a pre-existing mutable-access hole: an `&mut T` stored
behind a shared reference does not permit mutation or exclusive reborrowing of T.
The semantic place checker inspects every dereference in the access path. Thus
`**shared = value` and `&mut **shared` are rejected when `shared: &&mut T`.
An immutable local that directly owns an `&mut T` handle remains usable; root
binding mutability is not confused with shared access to its stored handle.

Tests cover every shared/exclusive combination in one-, two-, and three-layer
reference-storage chains for both writes and explicit reborrows, retaining the
valid all-exclusive cases.

## Backend integration and bounded work

The existing `borrow` MIR instruction is reused. Enum borrows add a tagged payload
projection to a place, preserving the variant and payload index. The MIR verifier
checks place schemas and projection bounds; the runtime checks the active tag and
payload bounds when resolving the address. MIR interpretation, generated JavaScript,
and host-assisted WebAssembly use the same reference-cell runtime. There is no
parallel lifetime interpreter or unchecked constant-expression evaluator.

Projection actions cache their places for a bind pass. Alternative comparisons and
loan work are charged to the existing pattern/place budgets. Source-address and
reference-storage traversal has an explicit depth budget. Failure does not publish
a successful ownership result into the query cache. Frozen AST, forged metadata,
actual semantic-query replay/invalidation, and budget recovery tests cover these
paths. Existing readonly SDK reports expose shared/mutable pattern-loan events and
charged pattern work without introducing unstable global place identities.

## Remaining boundaries

Implicit match ergonomics and `&pattern` / `&mut pattern` prefixes are covered by
the [reference-aware matching continuation](match-ergonomics.md). Function/closure
parameter patterns and reference bindings in for-loop yielded values are not added. Borrowed
array-rest subarrays need a range-reference representation; they currently fail with
`F_PATTERN_BORROW`. Mutable bindings to reference-holding storage require assignment-
aware inner-region tracking and are also rejected. Shared reference-storage bindings
work only with tracked origins. Newly introduced pattern paths reject untracked
reference-valued aggregate projections and aggregate reference carriers.

Constant-promoted temporaries are not inferred: a native-valid reference escaping a
literal tuple match may receive `E0597`. Capability cases are kept separate from the
native compile-fail corpus. Correlated exclusive or-patterns also remain a documented
capability rejection, not a false native language-error fixture.

Full NLL/region/outlives/HRTB/drop inference, universal generic-body checking,
general aggregate-reference propagation, arbitrary reference-storage assignment,
reference-returning closures, custom destruction order, unsafe provenance, pinning,
and async suspension ownership remain incomplete. Other pre-existing unsupported
reference paths are not all rejected; these changes do not certify unrestricted
Rust memory safety. Full language, standard-library, and native ABI parity are
separate work.

## Validation

```sh
node --test tests/reference-patterns.test.js
node --test --test-concurrency=4 tests/*.test.js
npm run check
npm run test:language
npm run test:ui:types
npm run format:samples:check
```

Accepted shared sources execute with optimization off/on through JSON-round-tripped
MIR, JavaScript, and host-assisted WebAssembly. The normal differential corpus sends
those exact same sources to native Rust edition 2024 at optimization levels 0/3,
with overflow checks enabled. Negative fixtures assert compiler diagnostics at both
browser optimizer settings. The suite includes a 96-case projected-loan/action
matrix and a reference-storage-chain matrix. Finite differential testing is not a
proof of whole-compiler equivalence.

References: [identifier pattern modes](https://doc.rust-lang.org/reference/patterns.html#identifier-patterns),
[move paths](https://rustc-dev-guide.rust-lang.org/borrow-check/moves-and-initialization/move-paths.html),
and [match guards](https://doc.rust-lang.org/reference/expressions/match-expr.html#match-guards).
