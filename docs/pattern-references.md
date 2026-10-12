# Explicit reference pattern bindings

`ref binding` and `ref mut binding` borrow the selected source storage rather than
moving the matched value. They extend the existing [projected pattern plans](pattern-ownership.md),
[ownership places](ownership-places.md) and [returned-reference contracts](borrow-contracts.md).
The implementation uses ordinary checked MIR references through interpreted MIR,
JavaScript and host-assisted WebAssembly; browser compilation does not invoke rustc.

```rust
struct Packet {
    name: String,
    payload: String,
    sequence: u32,
}

fn bump(packet: &mut Packet) -> &mut u32 {
    let Packet {
        ref mut sequence,
        ..
    } = *packet;
    *sequence += 1;
    sequence
}

fn main() {
    let mut packet = Packet {
        name: String::from("header"),
        payload: String::from("body"),
        sequence: 41,
    };
    {
        let Packet {
            ref name,
            ref mut payload,
            ..
        } = packet;
        payload.push_str("!");
        println!("{} {}", *name, *payload);
    }
    println!("{}", *bump(&mut packet));
    let Packet {
        name,
        ref payload,
        ..
    } = packet;
    println!("{} {}", name, *payload);
}
```

This exact example is `examples/12-pattern-references.rs`, is part of the native
differential corpus, and prints `header body!`, `42`, and `header body!` on separate lines.

## Binding types and source places

A binding has both a matched type and a reference type. `ref value` binds `&T`;
`ref mut value` binds `&mut T`. The latter makes the **pointee** mutable, not the
reference variable itself. Or-pattern alternatives must agree on their explicit
binding mode. Constant and constructor names cannot be shadowed by reference
bindings. Source-AST modifiers and storage annotations are validated: injected
source metadata cannot manufacture a private local or redirect a borrow.

Explicit bindings work at the root, in tuples, record shorthand or renamed fields,
tuple structs, named/tuple enum payloads, and fixed-array elements including fixed
prefixes/suffixes around ignored rest. They compose with `@` and or-patterns, and
with `let`, let-else, if-let, while-let, condition chains and match arms. Borrowed
array-rest views, reference-pattern destructuring and implicit match ergonomics
are different capabilities and are not silently approximated here.

The lowerer captures a place's base, index and dereference address once. Reference
bindings borrow that original place, never a copied aggregate register. Shared
and mutable bindings can coexist on disjoint projected fields. An owned field
can be moved while another field is borrowed. Reads of Copy subpatterns occur
before a whole-value mutable borrow (`ref mut whole @ (copied, _)`). Overlapping
non-Copy moves and reference bindings are rejected regardless of source order.
Declaration-owned Copy evidence remains separate from a concrete specialization.

Enum borrowing uses a checked `payload` projection on the existing reference
path, not a new opcode. The MIR verifier checks projection metadata; runtime
resolution validates the enum tag, integer index and bounds. The existing borrow
operation captures the selected payload storage, and all three backends share
that runtime path. This is not a general native pointer or enum-layout ABI.

## Loans, guards and temporary storage

Bindings attach their precise source places, borrower identities and parent-loan
authority to the existing local-liveness analysis. Last use releases a loan;
shared copies and direct-reference returns retain its required lineage. Borrowing
reference storage also checks its tracked pointee dependencies, preventing a
pointer-storage alias from bypassing a live conflicting reborrow. Function return
checking retains declaration-owned input contracts rather than inspecting a
callee's chosen field to narrow the caller's borrow.

Pattern moves are committed on successful selection edges. Candidate reference
bindings remain protected during guards, and failed guards release candidate
loans while preserving effects on outer state. If the match inspects predicates
such as discriminants or literals, a shallow guard lock protects the scrutinee's
identity even in a wildcard candidate. This does not prohibit unrelated sibling
field mutation. Binding-only/wildcard alternatives can replace unobserved storage;
subsequent reference arms reread the captured place without reevaluating its
address, so they observe the updated value.

A reference pattern on a value expression materializes a compiler-owned private
HIR local. Its storage is initialized once in the appropriate enclosing pattern
scope and participates in ownership/liveness like other locals. Let-pattern
references can therefore retain factory, tuple or scalar temporaries through
that scope. Match-local temporaries cannot escape their represented scope; this
implementation does not perform Rust's full constant promotion or observable
custom-destructor ordering. While-pattern temporary storage is initialized anew
on each executed header, and iteration loans use the existing bounded fixed point.

Closure capture analysis recognizes explicit shared/mutable pattern demands.
A shared reference-only pattern need not move an owned capture; mutable patterns
request mutable capture access. This does not add complete capture-field splitting
or reference-returning closure contracts.

## Isolation and work bounds

Source ASTs remain unchanged, including frozen or caller-supplied ASTs. Storage
plans are analyzer-owned, and typed HIR is reused only through the existing
semantic-query fingerprinting and immutable-result machinery. Pattern planning
and binding consume the existing bounded node/depth budgets. Failure cannot
publish a successful ownership query. Source-linked `shared pattern loan` and
`mutable pattern loan` events identify the same function-local ownership places
as ordinary borrows; readonly SDK `patternWork` and existing liveness/work counters
remain serializable. These IDs are not persistent across edits.

## Explicit compatibility boundaries

This is not full Rust ownership/NLL, region inference or a memory-safety
certification. Implicit match ergonomics and `&`/`&mut` pattern destructuring,
borrowed rest-array views, and reference bindings on `for` iteration storage remain
unsupported. General aggregate reference carriers, mutable reference-valued
storage, reference fields without tracked origins, arbitrary independent input
regions, reference-returning closures and promotion of escaping match temporaries
are not implemented. Covered cases fail explicitly rather than dropping a loan;
not every pre-existing unsupported reference path elsewhere is rejected.

Or-pattern origins use conservative unions rather than correlated alternative
worlds, so some native-valid swapped mutable bindings can remain rejected. Guard
and closure precision retain the surrounding checker's existing limitations.
Explicit lifetime syntax, higher-ranked/outlives/drop constraints, full NLL and
universal checking of uninstantiated generic bodies remain separate work, as do
custom Drop/destruction order, pinning, unsafe provenance, async suspension,
complete standard-library behavior and native ABI/code generation.

## Validation

```sh
node --test tests/pattern-references.test.js
node --test --test-concurrency=4 tests/*.test.js
npm run check
npm run test:ui:types
npm run format:samples:check
npm run test:language
```

Accepted sources run with optimization off/on through JSON-round-tripped MIR,
JavaScript and host-assisted WebAssembly. The **same source** is supplied to native
rustc, edition 2024, at optimization levels 0 and 3 with overflow checks enabled.
Negative source diagnostics are checked in both browser optimizer modes. The
nested-field matrix covers 64 borrow/read/write combinations. Separate tests cover
frozen/injected ASTs, real semantic-query replay and invalidation, resource failure
and recovery, enum-path validation, source-linked reports and the exact guide.
Known native-valid unsupported cases are separate capability tests, not misleading
native compile-fail fixtures. Passing this finite corpus does not prove complete
Rust equivalence. `--browser-only` never constitutes native validation.

References: [Rust patterns](https://doc.rust-lang.org/reference/patterns.html),
[Rust 2024 match ergonomics](https://doc.rust-lang.org/edition-guide/rust-2024/match-ergonomics.html),
[temporary scopes](https://doc.rust-lang.org/reference/destructors.html#temporary-scopes).
