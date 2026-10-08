# Transparent aliases and structural generic types

The browser compiler expands `type Alias<T> = ...;` in the declaration namespace. Alias and original type use identical layouts and runtime operations; aliases do not introduce nominal types. Imports, references, tuples, fixed-size arrays, generic applications and concrete enum/record alias constructors are supported. Generic record alias constructors accept explicit `::<T>` arguments.

Function `where` clauses produce ordinary source-linked obligations after substituting inferred arguments. They support bounds on generic parameters and concrete compound types, including the implemented Fn/FnMut/FnOnce signatures. This is not higher-ranked lifetime solving, associated-type normalization or full trait coherence. Alias declaration bounds are not asserted as universal proofs.

Tuple/array unification recurses structurally and checks arity and fixed lengths. `(T)` groups a type; `(T,)` is a one-element tuple. Qualified paths are not replaced when substituting a bare generic parameter of the same spelling.

The TypeResolver has a per-index cache bounded by 4,096 entries and 4 million characters. Alias recursion is diagnosed, type parsing is limited to 128 levels, and an expanded alias is limited to one million characters. Construction checks the budget before concatenating repeated substitution fragments. Query environment keys include aliases and where predicates, so an alias or constraint edit cannot replay stale type judgments.

The Types view exposes alias expansions and satisfied where obligations linked to original declarations. Tests execute the same cases in the MIR VM, generated JavaScript and actual WebAssembly with optimization enabled and disabled.

Not implemented here: default/const/lifetime alias parameters, opaque associated type aliases, inferred generic alias constructors without sufficient context, full bidirectional numeric inference, and arbitrary generic impl blocks.

References: https://doc.rust-lang.org/reference/items/type-aliases.html and https://doc.rust-lang.org/reference/items/generics.html#where-clauses
