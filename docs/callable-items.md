# Function items and safe function pointers

Ferrite distinguishes the identity of a function item from a stored `fn` pointer.
A concrete function item has a zero-field value whose target is statically known;
a pointer carries an exact, monomorphic parameter/result signature and an indirect
target. Function items, pointer values, and noncapturing closure adapters use the
same typed MIR on the interpreter, generated JavaScript, and host-assisted Wasm.

```rust
fn add_one(value: i32) -> i32 { value + 1 }
fn double(value: i32) -> i32 { value * 2 }
fn apply(callback: fn(i32) -> i32, value: i32) -> i32 { callback(value) }

fn main() {
    let mut callback: fn(i32) -> i32 = add_one;
    println!("{}", apply(callback, 4));
    callback = double;
    println!("{}", callback(4));
    let triple: fn(i32) -> i32 = |value| value * 3;
    println!("{}", triple(4));
}
```

## Implemented behavior

Function values preserve definition identity and generic specialization. Distinct
functions are not interchangeable under an inferred function-item type; an
explicit pointer type or a supported coercion site permits a change of target.
Concrete tuple-struct and tuple-enum constructors can be used as callable items;
private constructor fields are checked when taking the constructor value.
Renamed imports and supported generic `Fn`/`FnMut`/`FnOnce` bounds retain their
existing name-resolution and ownership checks.

Pointer coercions are available in typed bindings, arguments, returns, explicit
`as fn(...)` casts, and supported array/branch joins. Noncapturing closures can
coerce; capturing closures cannot. A shared or mutable reference to a pointer may
be called through autodereferencing. A call may reborrow `&mut T` as `&T` without
changing the stored pointer signature or weakening nested pointee types.

The callee is evaluated and snapshotted before arguments, and arguments execute
left-to-right. Replacing a pointer from inside an argument cannot change the
already selected call. Panics preserve earlier effects and prevent later ones.
The MIR verifier checks target existence, pointer signatures, parameter types,
result types, register identity, and definite initialization before execution.
The runtime also checks indirect target/signature identity.

Function-pointer equality uses the logical emitted target identity. This is not a
native address or an ABI promise. Native Rust may merge distinct function
addresses or duplicate a function across codegen units, so applications should
not use function-pointer equality as a portable semantic identifier.

## Constant evaluation and enum discriminants

Taking a function address in a constant does not execute the function body. An
address-only target is included in verified MIR, but does not acquire the enum
layout dependencies of a function actually executed during constant evaluation.
This distinction prevents false dependency cycles when an enum discriminant takes
the address of a function that accepts or produces that enum.

```rust
enum Code { First = 4, Second }
fn value(code: Code) -> i32 { code as i32 }
const READ: fn(Code) -> i32 = value;

fn main() { println!("{}", READ(Code::Second)); }
```

Direct invocation of a supported `const fn` item is checked constant evaluation.
Calling a function **pointer** in a constant remains rejected (`E0015`), even when
its current target is a const function. Address-only verification does not disable
enum-table validation for the final runtime module.

## Caches, portability, and limits

Function item metadata and adapters are compilation-owned. Exact project hits
remain supported. Sources that synthesize callable identities conservatively use
fresh semantic function queries; cached caller metadata must not retain generated
identities from another build. MIR and output query snapshots remain immutable.
Regression tests cover target body edits, enum discriminant edits, source offsets,
malformed indirect calls, and unchanged earlier compilation results.

This is a safe Rust subset, not full function ABI compatibility. Unsafe/extern
ABIs, variadics, higher-ranked lifetimes and full variance solving, native pointer
addresses and pointer/integer casts, target-feature ABI dispatch, user-defined
call traits, async function values, and arbitrary coercion/inference combinations
remain separate work. Full lifetime/NLL and partial-move analysis are not claimed.
Wasm currently uses the existing checked host-assisted ABI, not a native Rust
function-pointer layout. No overall compiler performance improvement is claimed.

## Reproduce

```sh
npm run build:workers
npm run build:sdk
npm run check
node --test tests/callable-items.test.js tests/callable-integration.test.js
npm run test:language
```

`test:language` requires installed rustc (or `RUSTC=/path/to/rustc`) and compares
reviewed complete Rust 2024 fixtures at native optimization levels 0/3 with overflow
checks enabled against both optimization modes of all browser backends. Browser-only
execution uses `node tools/language-conformance.mjs --browser-only` and does not
assert native conformance.
