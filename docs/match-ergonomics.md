# Reference-aware patterns and Rust 2024 match ergonomics

Local and conditional patterns can match references using explicit `&pattern` /
`&mut pattern` prefixes or inferred reference binding modes. This builds on the
[explicit `ref` / `ref mut` implementation](reference-patterns.md), projected
[pattern ownership](pattern-ownership.md), and declaration-owned
[returned-reference contracts](borrow-contracts.md).

```rust
struct Pair<T> {
    left: T,
    right: T,
}

fn first<T>(pair: &mut Pair<T>) -> &mut T {
    let Pair {
        left,
        ..
    } = pair;
    left
}

fn main() {
    let mut pair = Pair {
        left: 40,
        right: 2,
    };
    *first(&mut pair) += 2;

    // The explicit reference prefix copies the scalar, not its reference.
    let &snapshot = &pair.left;

    // The constructor pattern borrows its payload without moving the Option.
    let value = Some((snapshot, pair.right));
    if let Some((left, right)) = &value {
        println!("{} {}", *left, *right);
    }
    println!("{}", value.is_some());
}
```

Output is `42 2`, followed by `true` on a new line. Browser compilation executes
through Ferrite's existing MIR, JavaScript and host-assisted WebAssembly backends;
it does not delegate the program to rustc.

## Binding modes and syntax

Each top-level pattern begins in by-value mode. A structural non-reference pattern
matching a reference inserts a typed dereference and changes its descendants'
default binding mode to `ref` or `ref mut`. Tuple, array, record and enum patterns,
literals, ranges, named constructors, nested patterns and alternatives participate.
A bare identifier still binds the supplied value; a wildcard does not bind it.
`@` binders retain their own position in the pattern rather than inheriting a
mode chosen only by their subpattern.

A shared edge makes the inferred mode shared for that subtree, even through
subsequent mutable references. Mode state is lexical: it cannot leak into siblings,
other alternatives, or nested declaration checking. An explicit reference prefix
requires matching reference mutability and restores by-value mode for its child.
In the Rust 2024 rules implemented here, explicit `ref`, `ref mut`, `mut` or `&`
modifiers below an inferred prefix are rejected rather than silently reinterpreted.
The explicit/inferred spelling of alternative binding modes is retained separately
from the resulting reference type, matching native consistency checks.

Adjacent `&&` tokens split contextually for nested reference patterns without
mutating cached tokens. Reference-prefix ranges and alternatives need parentheses
where required by the pattern grammar; identifier `@` precedence is preserved.
Borrow-expression `&&` is parsed too, but this does not add rvalue promotion.

Named scalar constants retain their exact declared types. Matching `&number`
against an `i32` constant path is not equivalent to an unsuffixed integer literal;
use an explicit reference prefix when required. Constructor and constant resolution
happens before default binding modes, including associated constant paths.

## Checked places, origins and loan authority

Typed patterns contain explicit reference-edge nodes. The ownership plan traces
those edges using the pointer storage's tracked origins and loan identities, not
string field names or invented concrete alias assumptions. Traversing an edge
observes its pointer storage, while bindings access their selected projected
pointees. A failed match does not commit by-value moves.

Inferred reference bindings use the same projected loan/reborrow machinery as
explicit `ref` bindings. Non-Copy values cannot be moved through either shared or
mutable reference patterns. Mutable bindings cannot recover exclusive access
through a shared storage edge. Match guards keep their existing restrictions on
candidate bindings and source projections until arm selection.

The original loan is not narrowed merely by observing the callee body or pattern.
A child reference obtained from `&mut pair` retains that original whole-pair loan.
An independently named mutable handle can access a disjoint sibling through its
own authority while a selected child remains live. Direct accesses that conflict
with the retained parent are rejected. Moving or exclusively aliasing pointer
storage that another binding depends on is checked before publishing the bindings.

Reading a shared inner pointer copies its handle and can sever an outer pointer-
storage dependency, but retains the pointee loan. Reborrowing a mutable inner
pointer retains the required storage and exclusive ancestry. Unsupported local
aggregate pointer origins produce `F_PATTERN_REFERENCE`; they are not guessed.

Bindings and resulting references participate in existing branch/loop liveness,
scoped expiry, reinitialization, let-chain sequencing, returned-reference contracts
and loan transfer. The implementation remains bounded and conservative rather than
claiming general NLL or region inference.

## Declaration evidence and backend integration

Concrete specialization cannot authorize a reference pattern on an abstract `T`.
The declaration must establish the reference shape (possibly through a declared
associated equality). Pointee `Copy` privileges likewise come from declaration
bounds rather than the current specialization.

Implicit reference nodes exist only in checked typed HIR. The source AST is
unchanged, including when supplied frozen through the SDK. Incoming flags cannot
mark a source node as a compiler-owned implicit prefix or forge address storage.
The runtime lowering uses existing verified `read`, `deref` place projections and
`borrow` operations; there is no new runtime opcode or unchecked reference ABI.
Coverage proofs specialize a reference constructor and retain reference-shaped
missing-pattern witnesses. Source expressions and addresses execute once.

The analyzer's depth limits, ownership plan/work budgets, source-address checks
and coverage budgets remain enforced. Plan caches and mode state belong to one
analysis. Failures cannot authorize later cached compilation; tests exercise actual
semantic-query replay and invalidation. Source-linked ownership reports and their
existing `patternWork` counters include the new traversal work.

## Compatibility boundaries

This increment supports local `let`/let-else, if-let, while-let, let chains and
match patterns in the existing browser frontend. Function/closure parameter
patterns and borrowed for-loop iteration patterns are not added. Bare mutable
handle captures can retain the existing conservative closure-capture behavior;
explicit `&`/`&mut` source captures are covered by execution tests.

General aggregate reference carriers and field-region propagation remain
incomplete. In particular, dereferencing a reference stored in a local tuple can
fail with `F_PATTERN_REFERENCE` even when native Rust accepts it. Borrowed array-
rest bindings and mutable reference-storage bindings still need representations
not provided here. Correlated exclusive alternatives retain the existing explicit
restriction rather than fabricating disjunctive alias permissions.

Temporary promotion, arbitrary reference-valued storage mutation, full lifetimes /
regions / HRTB / outlives / drop checking, universal generic-body validation,
reference-returning closures, custom destruction order, pinning, unsafe provenance,
async suspension ownership, complete standard-library and native ABI support remain
separate work. `&str` retains Ferrite's existing immutable-value representation.
Per-crate edition selection is not introduced; these patterns use Rust 2024 rules.
Other pre-existing unsupported reference-carrying paths are not all rejected. This
is not a memory-safety certification for unrestricted Rust.

## Validation

```sh
node --test tests/match-ergonomics.test.js
npm test
npm run check
npm run test:language
```

Shared source fixtures run natively with installed rustc (edition 2024, optimization
0 and 3, overflow checks enabled) and through all three browser backends with
optimization off/on. Dedicated tests additionally round-trip MIR through JSON,
freeze accepted/rejected ASTs, replay real semantic queries, verify source-linked
loans and exercise malformed metadata, bounded analysis and error recovery.
The native-valid capability cases are separate from the compile-fail corpus;
`--browser-only` results never establish native validation. Normal CI retains
native Cargo/UI and normal HTTP/browser/IDE acceptance gates.

References: [Rust Reference patterns](https://doc.rust-lang.org/reference/patterns.html)
and [Rust 2024 match ergonomics](https://doc.rust-lang.org/edition-guide/rust-2024/match-ergonomics.html).
