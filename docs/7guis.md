# 7GUIs samples and sample browser

Open **Samples** in the workspace toolbar, **Projects → Browse Samples**, or **Search Everywhere → Browse Samples**. Choose the **7GUIs** category. Every sample has a live sandboxed preview, a JavaScript / WebAssembly / MIR selector, and read-only inspection of all Rust sources, CSS and view settings. Browsing does not replace or modify the current project. Changing the selected sample, switching to source inspection or closing the browser disposes its preview and worker request.

**Open as new project** archives the current workspace before replacing it; an archive failure leaves the workspace intact. **Add to current project** creates a unique `samples/7guis/<sample>[-N]/` directory with independent Rust modules, stylesheet and remapped view manifest. Empty directories count as occupied. File/directory conflicts, size limits and stale workspace revisions are checked before mutation. Add is one undoable workspace transaction. Compiler/Cargo examples remain separately discoverable and open as projects; their Cargo targets are not silently rewritten.

Installed UI views open in Design mode and retain the existing Code / Split / Design / Preview modes, document tabs, source editor tooling and per-document dockable panels. **Run** rebuilds the selected UI view, **Check** validates it without executing or resetting its preview, **Build** downloads complete standalone HTML, and **Debug** arms the view's event debugger. These UI commands do not try to invent a Rust `main`. Native/Cargo commands retain their existing explicit connection path. Browser UI views are not Cargo test targets; run the repository's sample test commands below.

## Seven tasks

| Task | Implemented interaction |
| --- | --- |
| Counter | Initially zero, read-only count and one increment per activation. |
| Temperature Converter | Both fields initially empty; either edits the other. Invalid, incomplete or non-finite input preserves the opposite value. |
| Flight Booker | One-way/return selection, strict Gregorian `dd.mm.yyyy` validation including leap years, invalid-field highlighting, dependent enabled states, date ordering and booking confirmation. |
| Timer | Elapsed-time gauge and number, immediately applied duration slider, completion, extension/resumption and reset. A lifecycle-owned interval supplies measured monotonic elapsed milliseconds. |
| CRUD | Immediate surname-prefix filtering, single selection, stable record IDs, editable name/surname and guarded Create/Update/Delete. Filtering and deletion cannot redirect an operation to a different row. |
| Circle Drawer | SVG canvas, nearest-containing-circle selection, context-menu diameter editor, immediate size preview and one undoable command when editing closes. Undo/redo includes creation and resizing and truncates abandoned future history. |
| Cells | Scrollable A–Z / 0–99 grid, double-click/Enter/F2 editing, original formulas while editing, Enter/blur commit, Escape cancellation, keyboard navigation, incremental formulas and cycle recovery. |

The source tasks are based on the [7GUIs specification](https://eugenkiss.github.io/7guis/tasks/). These are editable Rust/view! applications, not JavaScript widgets standing in for Rust logic. Domain transitions live in separate `model.rs` modules. Cells' `Grid` component accepts a `Signal<Sheet>` and is reusable independently of the sample shell.

## Cells language and recalculation

A leading `=` introduces a formula. References are case-insensitive `A0` through `Z99`; rectangular ranges use `A0:B9`. Supported operators are `+`, `-`, `*`, `/`, unary signs and parentheses, including decimal/scientific numbers. Functions are `add`, `sub`, `mul`, `div`, `mod`, `sum`, `prod`, `avg`, `count`, `min`, and `max`. The first five take two scalar arguments; the aggregate functions also accept ranges. Examples: `=A0+2`, `=sum(A0:B9)`, `=div(mul(A0,3),2)`.

Empty cells display empty and contribute zero when referenced. Text is displayed literally; using text as a numeric value produces `#VALUE!`. Other explicit errors are `#DIV/0!`, `#REF!`, `#CYCLE!`, `#NUM!`, `#NAME?`, and `#ERROR!`. This is a defined small formula language, not Excel file/function compatibility.

Parsing produces bounded reverse-Polish instructions and deduplicated dependencies, never JavaScript evaluation. Each source edit removes that formula's previous reverse edges, installs the new edges, walks only the dependent closure and evaluates it in topological order. Cells in cycles and their dependent closure receive a cycle error; removing an edge allows recovery. Unrelated formulas are not reevaluated. The displayed evaluation count and regression tests check this explicitly. The owned Rust `Sheet` is still cloned through the signal boundary and the grid is reconciled on committed edits; incremental formula evaluation does not imply zero-copy model or virtualized DOM rendering. Uncommitted text stays in the native input, avoiding a full-grid render per keystroke.

## Compiler and UI additions

Checked numeric `parse::<T>()` returns typed `Result`, including integer bounds checks rather than JavaScript prefix parsing. The supported text/vector operations include `String::new`, `push`, `as_str`, `trim`, `into_bytes`, case conversion, prefix/substring checks, `is_empty`, and checked `Vec::remove`; floating helpers include `is_finite`, `abs`, `floor`, and `round`. Ownership analysis borrows comparison operands, preserves continuing paths after divergent branches and treats consuming/mutating methods accordingly. Derived owned fields are resolved in their declaration module. Component props are cloned at their repeated-render boundary, so captured owned props are not consumed after the first invocation.

`ui::state_with(factory)` initializes owned state lazily. `ui::interval(milliseconds, callback)` is a hook: call it unconditionally in a stable position. Zero disables ticking; changing the interval replaces the timer; closing/disposal clears it. The callback receives elapsed milliseconds, uses the latest captured bindings, and pauses while the event debugger is armed. DOM event snapshots add current-target-relative `offset_x` / `offset_y`, using the inverse SVG screen transform for a scaled canvas.

The view manifest accepts an explicit `maxSteps` budget between 1 and 2,000,000 per render/event, also exposed in Settings / Export. Ordinary views retain the existing 250,000 default. Circle Drawer uses 1,000,000 and Cells 2,000,000. The budget travels through compiler-worker operations, designer previews, IDE commands and exported HTML; it is not an unlimited execution setting. Other memory, value-depth, compiler and event budgets remain enforced.

## Build and verification

```sh
npm run build:7guis            # Regenerate the catalog from examples/7guis
npm run check                 # Includes exact catalog and bundle determinism
npm test
npm run test:ui:types
npm run test:7guis
npm run test:7guis:browser     # All seven tasks × JS/MIR/Wasm, then the real IDE
node tools/seven-guis-native.mjs  # Requires rustc; checks the same domain modules
node tools/export-seven-guis.mjs  # 21 standalone HTML files under artifacts/7guis/exports
```

The browser suite executes exported HTML with all network requests denied. It then uses the actual IDE to test browsing, source inspection, independent additions, project replacement, Run/Check/Build and narrow-screen access. CI serves the IDE over HTTP with production workers and also compiles/executes the checked-in domain modules with `rustc`. Existing native UI, compiler differential, agent/terminal, designer, language-tooling, SSR/hydration and React gates remain enabled.

`FERRITE_MEMORY_TEST=1` is a restricted-container delivery fallback for the IDE test only. It loads the same repository modules in memory; it does not validate HTTP delivery, browser persistent storage or native toolchain installation. Standalone export execution is real in either mode. Results and screenshots are retained under `artifacts/7guis`.

## Explicit limits

The samples target Ferrite's browser Rust UI ABI and its JavaScript, checked-host WebAssembly and MIR backends. They are not advertised as complete native Cargo UI applications or general Rust/stdlib parity. The separate domain modules are checked with rustc, while native UI ABI feature parity is a separate concern. Preview/runtime state resets on rebuild, reload or session eviction; installed sources and designer layouts use the existing project persistence. Browser storage can fail, and save failures are reported.

Cells has 2,600 cells, a 4,096-byte source limit, 1,024 parser instructions and nesting depth 48, plus the shared execution/value budgets. Circle Drawer allows 1,000 circles and diameter 1–200; CRUD allows 10,000 records. These are bounded demonstration applications, not unbounded document engines. A diameter dialog is an in-browser modal surface, not a separate operating-system window.
