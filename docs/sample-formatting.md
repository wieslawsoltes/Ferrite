# Readable sample sources

Sample source code is kept readable in the repository, sample browser, editor and
new-project/view templates. The formatting pass covers all Rust files below
`examples/`, the native UI example, the embedded Rust catalogs in `src/samples.js`
and `SampleCatalog.js`, the three UI templates, the new-project/view templates,
and both Rust snippets in `examples/ui-embed.html`. The four sample stylesheets
are expanded to one declaration per line. Generated 7GUIs catalog entries contain
these same formatted sources; do not edit the generated catalog manually.

## Style

Rust uses four-space indentation, a 100-column target, multiline function bodies,
separate declarations/statements, expanded struct/enum fields and initializers,
and indented callback bodies. Top-level definitions are separated by blank lines.
Imports, modules, expressions, event bindings and sample names are not reordered.
The shared options are in `tools/sample-rustfmt.toml`.

`view!` uses the compiler's `ViewSyntax` parser: structural children are indented,
attribute lists expand one attribute per line, and long Rust expressions inside
attributes are formatted independently. Short text-only elements may remain on
one line. Long prose can wrap only when its normalized text is identical.

Mixed text such as `Hello, {name}!` or `Duration: {n} seconds` is deliberately kept
on its original text boundaries when a newline would strip a significant space.
This is important because the macro's whitespace rules differ from ordinary
HTML. Strings, escaped markup, attribute values and meaningful spaces are not
changed to make a line shorter. CSS selector whitespace, strings and URLs also
retain their meaning.

## Commands

Install the pinned formatter once, then format or check without modifying files:

```sh
rustup toolchain install 1.90.0 --profile minimal --component rustfmt
npm run format:samples
npm run format:samples:check
```

The command selects `rustup run 1.90.0 rustfmt`; `RUSTFMT` can override the executable
path for an equivalent pinned installation. No Rust toolchain is needed merely
to open the browser IDE or to run the ordinary Node unit tests.

Before writing any sample, the command checks parsed Rust structure and parsed
view structure/text against the input and checks that formatting is idempotent.
The comparison ignores source positions and cosmetic syntax introduced by
rustfmt, such as trailing separators or pure expression wrappers. It is a guard
for these sample sources, not a general proof of Rust program equivalence.
Template substitutions in JavaScript catalog scaffolding are never executed.

Formatting regenerates the 7GUIs catalog and deterministic worker/SDK assets.
`--check` does not write files. The existing CI workflow runs the pinned formatting
check alongside syntax/catalog verification, unit tests, native Rust domain
checks and the complete 7GUIs and IDE browser acceptance suites. No formatting is
applied automatically to user projects at runtime.
