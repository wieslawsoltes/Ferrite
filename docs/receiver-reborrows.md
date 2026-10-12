# Method receiver reborrows

A user-defined method whose receiver is `&self` or `&mut self` now borrows through
an existing reference instead of moving the reference handle. The type of the
inserted reborrow comes from the method signature. Calling an `&self` method on
an `&mut T` therefore passes `&T`, not mutation authority that the method never
declared. An immutable local binding that holds `&mut T` can still mutate `T`.

```rust
trait Counter {
    fn get(&self) -> i32;
    fn set(&mut self, value: i32);
    fn increment(&mut self) { self.set(self.get() + 1); }
}
struct Value(i32);
impl Counter for Value {
    fn get(&self) -> i32 { self.0 }
    fn set(&mut self, value: i32) { self.0 = value; }
}
fn main() {
    let mut value = Value(40);
    let counter = &mut value;
    counter.increment();
    counter.increment();
    println!("{}", counter.get());
}
```

The example prints `42` and runs on the MIR interpreter, generated JavaScript
and host-assisted WebAssembly, with optimization enabled or disabled.

## Reservation, activation and address evaluation

Compiler-inserted mutable method receivers use two phases within the existing
[projection-sensitive loan checker and CFG local-liveness solver](ownership-places.md). Reservation precedes arguments, permits
reads, and rejects an overlapping live mutable loan. After arguments finish,
activation rejects remaining conflicting loans. This admits `r.set(r.get()+1)`
without allowing mutation of the receiver during argument evaluation. Shared
reference arguments stay live through activation, even when their source-level
last use appears earlier in the call. Nested calls release only their own
temporary loans; they cannot release the enclosing receiver's reservation.

An explicit source `&mut` remains an immediate exclusive borrow, not a two-phase
reservation. Anonymous temporary loans never grant the authority of a named
reference: a null borrower identifier is not an exemption from conflict checks.
Ownership reports expose reservation, shared reborrow and activation events.

The MIR `borrow` instruction now resolves its location immediately in the shared
runtime. A reference captures the selected storage cell/member, not a path that
will be reevaluated through a replaceable reference register. Index expressions
execute once, and an invalid receiver index fails before later arguments run,
even when the method body would never read its receiver. All three backends call
the same `Runtime.borrow` operation. Ordinary write-place construction remains
separate, so initialization is not turned into a read of uninitialized storage.

## Tests and scope

```sh
node --test tests/receiver-reborrows.test.js
node tools/language-conformance.mjs --browser-only
node tools/language-conformance.mjs
```

The last command requires installed rustc and is the native differential gate;
passing `--browser-only` does not establish native conformance. The shared corpus
contains execution, compile-failure and pre-panic-output cases. Unit tests also
inspect receiver parameter types, immutable query replay, loan events, and the
runtime's captured-location contract.

The shared checker now supports projected places, explicit reborrow ancestry and
[direct-reference return contracts](borrow-contracts.md), but not full Rust NLL or
universal region inference. Calls on returned direct references retain tracked
argument origins. Direct-reference method results no longer have the old blanket
`F_IMPL_REFERENCE` restriction; aggregate reference carriers retain that boundary.
Reference-shaped argument reborrows now share the reservation/activation machinery.
Untracked receiver origins still report `F_REBORROW_REFERENCE`. Complete coercions,
overloaded operators, builtin fast paths, lifetime subtyping and arbitrary aggregate
reference transfers remain separate work. This is not a safety certification for
unrestricted Rust or a replacement for native rustc's full borrow checker.

The reservation/activation distinction follows the Rust compiler development
guide: https://rustc-dev-guide.rust-lang.org/borrow_check/two_phase_borrows.html
