# Associated-type bound arguments

Ferrite supports bounds on non-generic associated outputs, including
`Source<Item: Copy>`, `Source<Item: Copy + Display>`, and nested forms such as
`Source<Item: Transform<Output: Copy>>`. These extend
[associated-type equality bindings](associated-bindings.md); they do not add
runtime objects or a second compiler/interpreter.

```rust
trait Source {
    type Item;
}

struct Bytes;

impl Source for Bytes {
    type Item = u8;
}

fn pair<S: Source<Item: Copy>>(value: S::Item) -> (S::Item, S::Item) {
    (value, value)
}

fn main() {
    let result = pair::<Bytes>(7);
    println!("{} {}", result.0, result.1);
}
```

Output: `7 7` followed by a newline. The same checked specialization executes in
MIR, generated JavaScript and host-assisted WebAssembly.

## Representation and resolution

`TypeSystem.traitApplication` distinguishes positional inputs, labelled output
equations (`{name, type}`), and labelled predicates (`{name, bounds}`). A predicate
is not a type argument or an equation. Labels such as `Item` and `Output` retain
their associated-item namespace even when a generic type parameter has the same
name. Positional arguments alone participate in trait-selection identity.

The existing declaration-local binding service resolves each label to its actual
declaring trait, taking directly declared members before inherited members and
rejecting ambiguous unrelated inherited declarations. Finite nested syntax is
elaborated into obligations on qualified projection identities. Recursive
associated declarations, such as `trait Node { type Next: Node; }`, are expanded
only as an actual queried projection requires; there is no eager infinite graph.

Generic and `where` bounds, supertraits, associated-type declaration bounds,
implementation obligations, and existing return-position `impl Trait` checks use
the same service. Named, empty (`Item:`), repeated, parenthesized and trailing-plus
bounds are retained and validated. Empty bounds still require a real member.
Nested callable signatures preserve their generic type parameters. `str` can
satisfy `Display` as an unsized associated output; a bound argument does not
silently introduce `Sized`.

Nested output equations continue to support directed inference. For example,
`T: Source<Item: Transform<Output = U>>` can determine `U` after the inputs of both
projections are independently known. `T: Source<Item: Transform<U>>` does not
constrain an otherwise unknown implementation parameter `U`: it is an input, not
an injective output. The compiler never searches for an implementor by reversing
an associated output.

An explicit output equation also transfers declared predicate evidence. From
`T: Source<Item = U> + Source<Item: Copy>`, the environment can prove `U: Copy`.
A bounded worklist propagates these obligations along unique declared equations;
it never imports evidence from a concrete layout. Contradictory unused generic
assumptions remain lazy, as in the existing equality implementation.

## Symbolic ownership and method contracts

Monomorphization does not grant an abstract value the privileges of its concrete
substitution. The ownership pass now receives `Copy` decisions proved from the
expression's declaration-level origin. Thus an instantiated `fn f<T>(x: T)`
cannot copy `x` twice merely because this call uses `u8`. The same rule applies to
projected values, array repetitions, helper results and associated constants.

Closure capture origins retain the enclosing declaration's proof environment,
including through nested closures. A generic `Fn` value can still be invoked
repeatedly without a `Copy` bound; invocation and copying the callable value are
different operations. Associated constants materialize concrete values but retain
the trait contract's abstract result origin for subsequent local ownership and
method checks. A concrete associated-constant initializer cannot grant a missing
`Copy` proof.

Trait implementation method signatures are compared in the public trait contract
with method binders still symbolic. Bodies use the implementation's explicit
bounds, not constraints omitted from that implementation. This accepts equivalent
inline/`where` constraints and a read-only implementation that omits a stronger
public bound, while rejecting a checked body that attempts an undeclared copy.

Bounds on a projected value do not import traits into lexical scope. Generic
method selection still distinguishes declaration evidence, lexical visibility and
concrete inherent members. Associated-function lookup preserves owner turbofish
arguments, including transparent aliases, before applying these rules.

## Isolation and limits

Predicate tables share the declaration/parameter-set lifetime of equation tables
but remain separate maps. Normalization caches, equation-construction suppression,
proof origins and candidate inference remain compiler-only side tables. Free
alias bounds do not refine an actual associated output or grant a proof in a
neighboring declaration. Source ASTs remain immutable; semantic-query replay
invalidates when effective bounds change.

The existing binding budgets now account for both equation and predicate keys
and characters: 100,000 binding operations per compilation; at most 4,096 keys
and 4,000,000 characters per environment; and at most 32 parameter-set variants
per declaration. Nested obligation elaboration and demand-driven inherited
evidence have depth limits of 64. Bound parsing uses the type-depth limit of 128.
The `Copy` proof memo is per method origin scope, bounded by 1,024 entries and
1,000,000 key characters; individual keys over 32,768 characters are not retained.
Existing implementation-proof, trait-graph and normalization limits also apply.
All active suppression and inherited-query guards are restored after failure.

`sem.associatedBindings.predicates` counts the predicates actually constructed.
Executable MIR layout types and callable signatures remain concrete, and no
associated-bound opcode or executable equation interpreter is introduced.
Compiler workers and the standalone SDK are rebuilt from the source modules.

## Validation and remaining boundaries

```sh
node --test tests/associated-bounds.test.js
npm test
npm run check
npm run test:language
```

The shared accepted and rejected source fixtures are also supplied unchanged to
native Rust, edition 2024, with native optimization levels 0 and 3 and overflow
checks enabled. Dedicated accepted fixtures execute browser optimization off/on
through JSON-round-tripped MIR, JavaScript and host-assisted Wasm. Additional
checks cover frozen ASTs, actual semantic-query replay, proof isolation, budget
failure/recovery and absence of symbolic constraints in executable MIR types.
`--browser-only` explicitly records `nativeValidated: false`; it does not replace
the native differential or normal HTTP/browser CI gates.

This increment does **not** implement universal checking of uninstantiated generic
bodies. The native discovery probe below is still rejected by rustc with E0382
but accepted by Ferrite when `f` is never instantiated:

```rust
trait A { type Item; }
trait B {
    fn f<T: A<Item: Copy>>(x: T::Item) -> (T::Item, T::Item);
}
struct S;
impl B for S {
    fn f<T: A>(x: T::Item) -> (T::Item, T::Item) { (x, x) }
}
fn main() {}
```

Its instantiated form is a shared compile-fail regression. Native discovery
results are not described as complete Rust parity or as all passing merely
because the supported regression corpus passes.

Other remaining limits include GATs, lifetime/HRTB associated constraints,
associated bindings on `dyn` objects, conditional associated-item where clauses,
trait parameter defaults, full opaque-type semantics, arbitrary symbolic
projection equations and a complete trait solver. `?Sized`/other relaxed bound
arguments are rejected, while lifetime/HRTB forms have an explicit unsupported
feature diagnostic. Full NLL/lifetimes, const generics, macros, async, standard
library coverage and native ABI/code generation remain separate work.

References: [Rust Reference: generic arguments](https://doc.rust-lang.org/reference/paths.html#generic-arguments),
[RFC 2289: associated-type bounds](https://rust-lang.github.io/rfcs/2289-associated-type-bounds.html).
