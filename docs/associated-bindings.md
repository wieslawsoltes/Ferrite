# Associated-type equality bindings

Ferrite supports equality constraints on non-generic associated types in declared
trait bounds: `T: Source<Item = i32>`, `where T: Source<Item = U>`, and inherited
or nested forms such as `type Item: Source<Output = i32>`. These are compile-time
type constraints, not new runtime objects, property lookups or interpreter hooks.

```rust
trait Source {
    type Item;
    fn get(self) -> Self::Item;
}

struct Number(u8);

impl Source for Number {
    type Item = u8;
    fn get(self) -> Self::Item { self.0 }
}

fn keep<T: Source<Item = U>, U>(value: U, source: T) -> (U, U) {
    (value, source.get())
}

fn main() {
    let pair = keep(20, Number(22));
    println!("{}", pair.0 + pair.1);
}
```

Output: `42` and a newline. The owner supplies `U = u8`; the preceding literal
receives that contextual type without changing argument evaluation order.

## Identity and evidence

A trait application's **positional arguments** select its identity. Associated
bindings are retained separately as labelled equations. `Source<Item = i32>`
selects `Source` for the specified self type, then checks the selected associated
output against `i32`. It does not search implementations for any owner returning
`i32`. The canonical equation key is `<SelfType as DeclaringTrait<Args>>::Item`.

The declaration-local environment includes generic bounds, where predicates,
applied supertraits, trait/default-method context and implementation context.
Inherited bindings resolve to their declaring trait, with diamond paths deduplicated.
A directly declared item takes binding precedence over an inherited same-name
item. Unrelated inherited definitions require disambiguation. A qualified type
projection still names its actual declaring trait.

RHS types are resolved in the declaration namespace before caller substitution.
Aliases, arrays, tuples, function pointers and nested projections are structural
RHS values. Associated-item labels and projection member names are never generic
substitution targets, even when a type parameter also happens to be named `Item`.

Symbolic equations belong to their declaration, not a concrete-value cache.
A previous `<S as Source>::Item` result cannot refine an unrelated generic body.
Concrete successful normalization continues to use the existing qualified memo.

## Directed output inference

Ordinary argument positions and explicit type arguments first constrain the
inputs. A selected input's associated output can then determine still-unknown
function or implementation parameters. This supports `T: Source<Item = U>` and
structural equations such as `T: Source<Item = (U, bool)>`. Forward dependencies
are processed to a bounded fixed point, including multi-trait chains.

Impl parameter well-formedness follows the same direction: a parameter occurring
only as an associated output is constrained when all projection inputs are already
constrained. A parameter used only inside a non-injective projected RHS is not.
Structural output matching is invariant, not expression/reference coercion.

`ProjectionInference` retains pending projections and defers only literal trees.
Nonliteral checking order, side effects, ownership events and generated runtime
evaluation order stay unchanged. Output inference also participates in function
item and function-pointer specialization. Inference does not overwrite explicit
arguments or exempt an instantiated function from its trait/where obligations.

## Native semantic distinctions

Repeated identical bindings are permitted. Even contradictory generic assumptions
can be accepted when unused; a projection requiring their ambiguous value is
rejected, as is an actual instantiation that cannot satisfy every constraint.

Free type-alias bounds are **not enforced as refinements**, matching the native
Rust behavior exercised by the shared fixtures. For example, if `S::Item` is
`bool`, `type V<T: Source<Item = i32>> = T::Item` still gives `V<S> = bool`.
The alias's bound member names are validated, but they cannot replace the selected
output. An alias parameter must actually occur in its RHS; merely mentioning it
in a bound does not satisfy the unused-parameter check. Nominal fields retain
syntactic parameter use even if an equality makes their eventual layout concrete.

An explicit trait implementation is checked for signature equivalence in the
trait method's public contract. Its body retains the **explicit implementation
bounds**, not omitted equality evidence from the public signature. This separation
preserves symbolic method selection and checks projected return origins against
the body declaration, including explicit returns. It is not a universal generic
body checker: Ferrite's broader monomorphized-checker limits still apply.

## Isolation, limits and artifacts

Equation tables are indexed by declaration identity and symbolic parameter set.
Construction suppresses recursive refinement using a distinct type-query cache
key; all guards are restored on failure. Changes to an effective method contract
invalidate its declaration cache. Candidate output inference has a separate
recursion guard, and failed matches cannot authorize later candidates.

The binding service has a 100,000-query budget, at most 4,096 equation keys and
4,000,000 accounted equation characters per environment, at most 32 cached
parameter-set variants per declaration, and at most 64 active output-inference
queries. Existing normalization and structural-matching depth budgets also apply.
These are compiler resource limits, not rustc acceptance guarantees.

`sem.associatedBindings` exposes actual query, environment-build and inferred-
argument counters. Equations remain compiler metadata. Executable MIR layout
and pointer-signature types are concrete; there is no new runtime opcode. The
existing MIR VM, generated JavaScript and checked host-assisted WebAssembly ABI
execute the same specialized values. Compiler workers and the SDK are regenerated
from the source modules.

## Validation

```sh
node --test tests/associated-bindings.test.js
npm test
npm run check
npm run test:language
```

The shared fixtures cover accepted and rejected programs and are used unchanged
by the installed-rustc oracle, edition 2024 at native optimization levels 0/3 with
overflow checks enabled. Dedicated tests execute optimization off/on through
JSON-round-tripped MIR, JavaScript and host-assisted WebAssembly. Additional tests
exercise frozen ASTs, genuine warm query replay and invalidation, alias/context
separation, invariant output inference, failure recovery, resource budgets and
runtime artifact isolation.

The 30 standalone native discovery probes used rustc 1.99.0 (`b940084d7`,
2026-09-28); their distinct source cases are retained in the shared corpus.
`--browser-only` explicitly records `nativeValidated: false`. Only the unchanged
full native/HTTP/browser CI run constitutes that broader validation.

## Remaining boundaries

This continuation does not implement GATs, `Source<Item: Copy>` shorthand,
associated bindings on `dyn` objects, higher-ranked/lifetime bindings, conditional
associated-item where clauses, trait type-parameter defaults, or general symbolic
projection equations in impl heads. Forward output inference is not inverse
implementation search or a complete constraint solver. Arbitrary nonliteral
bidirectional expression inference and universal parametric-body validation remain
incomplete. Full NLL/lifetime, macros, async, standard-library and browser-native
ABI/code-generation parity remain separate work.

Reference: [Rust Reference: associated items](https://doc.rust-lang.org/reference/items/associated-items.html).
