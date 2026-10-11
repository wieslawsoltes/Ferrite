# Relaxed Sized bounds and unsized storage

The browser compiler supports `T: ?Sized` on declared type parameters, including
`where T: ?Sized`, and qualified or renamed `core::marker::Sized` / `std::marker::Sized`
paths. A relaxation removes an implicit requirement; it does not prove that a
type is unsized. Positive `Sized` evidence, including the existing `Copy` and
`Clone` supertrait evidence, can restore that requirement.

```rust
trait Text {
    fn bytes(&self) -> usize;
}

impl Text for str {
    fn bytes(&self) -> usize {
        self.len()
    }
}

fn bytes<T: ?Sized + Text>(value: &T) -> usize {
    value.bytes()
}

struct Marker<T: ?Sized = str>(std::marker::PhantomData<T>);

fn main() {
    let _marker: Marker = Marker(std::marker::PhantomData);
    println!("{}", bytes::<str>("café"));
}
```

Output: `5`. The existing immutable string-view representation is used by all
three browser backends. This feature does not delegate browser compilation to
rustc and does not introduce a new runtime opcode.

## Declaration evidence and storage

Relaxations are source-spanned syntax, separate from positive trait bounds and
associated-output equations. Only the compiler-owned `Sized` trait can be
relaxed. Duplicates, unknown traits, user-defined lookalikes, and relaxations on
concrete types, projections or an enclosing item's parameters are diagnosed.
Required trait methods may describe unsized by-value signatures; a function or
method body must satisfy the supported by-value signature checks.

`SizedTypes` traverses stored fields instead of assuming that every generic type
argument contributes to storage. References, function pointers and `PhantomData`
break the storage dependency. Thus `PhantomData<str>` and a struct containing only
that marker are sized; a struct storing `str` as its tail is not. Every non-tail
struct field, enum payload and fixed-array element must be sized. References to
well-formed unsized-tail types may occur in signatures. Direct recursive storage
is rejected independently of whether the resulting size proof would be false.

Nominal and trait inputs still have their own well-formedness obligations. For
example, `Vec<str>` is not made well-formed merely because a vector handle has
fixed-size storage. Free type-alias parameter bounds retain Rust's existing
non-enforcement behavior; the expanded type must be well-formed where used.

Implementation selection, generic argument defaults and trait contracts consult
the same relaxation metadata. An implementation cannot add an implicit `Sized`
requirement to a required method whose type parameter was relaxed. Conversely,
checking an explicit, less-restrictive implementation body cannot borrow extra
requirements from the public method contract.

During instantiated-body checking, symbolic Sized origins follow local values,
helper-call generic arguments and inherited closure environments. Substituting
`i32` for a relaxed `T` does not authorize materializing a `T` local or forwarding
it to a function that requires `Sized`. The mechanism is not universal checking
of every uninstantiated generic body.

`PhantomData<T>` retains its unconditional storage and Copy properties even when
`T` is an unresolved, relaxed parameter. Derived Copy/Clone/Default instantiations
with unsized generic arguments are rejected. The pre-existing field-based derive
checker for **sized** arguments is not replaced by full Rust derive expansion in
this increment.

## String method dispatch

A trait implemented for `str` is available through `&str` without constructing a
borrow of a fictitious runtime cell. The primitive string view is passed directly
when the formal receiver is `&str`. Concrete string `len()` retains inherent
precedence, while a generic `T: Len` call preserves its declared trait dispatch.
This does not implement arbitrary autoderef, deref coercions or dynamic dispatch.

## Isolation and bounded work

Relaxation metadata belongs to each declaration index. It does not mutate source
ASTs or attach proof tokens to replayed HIR. Metadata is refreshed when indexed
method contracts replace their generic/predicate arrays. Structural traversal has
query, depth and type-length limits; active storage edges unwind on errors.
Canonical, fully concrete well-formedness results use an entry- and character-
bounded cache. Failed obligations and unresolved inference holes are not cached.

Compilation statistics expose `sem.sizedTypes`, including proof queries, visited
storage fields, checked declarations, and concrete cache occupancy. Tests replay
actual semantic queries, edit bounds, fail compilation and then recover. Generated
MIR register types contain only resolved types, not `?Sized` syntax or proof
identities.

## Validation and boundaries

```sh
node --test tests/relaxed-sized.test.js
npm test
npm run check
RUSTC=/path/to/rustc npm run test:language
```

Exact-source cases are shared between native Rust (edition 2024, native opt levels
0/3 with overflow checks) and MIR/JavaScript/host-assisted Wasm (optimization off/on).
Dedicated parser cases also retain Ferrite-specific diagnostics for grammar where
native rustc does not provide a numbered error. A browser-only conformance run is
not native validation. Normal CI retains the native Cargo, HTTP/browser, IDE,
agent, UI and debugger acceptance gates unchanged.

This increment does **not** add slice `[T]` types, trait-object or raw-pointer ABI
layouts, unsizing coercions, unsized-tail construction, `size_of`/`align_of` layout
intrinsics, arbitrary temporary-reference lifetimes, or general reference-return
analysis. In particular, borrowing a literal such as `&7` remains outside the
supported temporary-borrow subset; binding it to a local before borrowing is
covered. Rejection of a type parameter used only through recursive occurrences
requires the separate variance/recursive-parameter analysis and is not provided
by a finite storage-size proof.

GATs, lifetime/HRTB analysis, whole-body backwards inference, universal generic
body checking, full derive expansion, complete NLL, macros, async lowering,
standard-library semantics and native code generation remain separate work.
Passing the shared finite corpus does not establish full Rust parity.

References: [Rust Reference: dynamically sized types](https://doc.rust-lang.org/reference/dynamically-sized-types.html)
and [Rust Reference: trait bounds](https://doc.rust-lang.org/reference/trait-bounds.html#sized).
