# Rust and `view!` editor tooling

The main editor and the independent split editor share the same source-aware language pipeline. Opening a `.rs` file does not require a native bridge for syntax colors or browser-supported language commands. UI view files and their known helper modules use the Ferrite UI compiler for semantic analysis. Ordinary Rust uses the browser compiler by default and the connected native rust-analyzer when available.

## Editing commands

| Command | Keyboard | Behavior |
| --- | --- | --- |
| Completion | Ctrl/Cmd+Space | Contextual list at the focused editor caret; Up/Down select, Enter/Tab accept, Escape dismiss |
| Definition | F12 or Ctrl/Cmd+B | Navigate the focused editor to a resolved project-local definition |
| References | Alt+F7 | Original-source occurrences in the Rust tooling panel |
| Documentation | Ctrl/Cmd+Q | Resolved Rust type or UI element/attribute/API documentation |
| Signature | Ctrl/Cmd+Shift+Space | Signature and current parameter; also automatic after `(` and `,` |
| Rename | Shift+F6 | Preview a revision-checked edit transaction, then explicitly apply; Undo refactoring restores it |

The Rust tooling window and Search Everywhere expose the same commands. Automatic completion is debounced while typing identifiers, paths and markup prefixes. IME composition is never intercepted. Moving the caret, changing source, replacing the workspace or opening another document invalidates pending results. Modal rename retains the captured symbol even when browser focus restoration resets the textarea selection, but never survives a source revision change.

## Syntax and source fidelity

`RustDocument` is a tolerant editor scanner, separate from the strict compiler lexer. It emits a lossless sequence of original UTF-16 source slices. Raw identifiers keep `r#`; Unicode identifiers retain their original spelling even when the semantic name is NFC-normalized. Comments, nested comments, lifetimes, raw/byte/C strings, character literals and unfinished edits remain independently highlighted. An invalid scalar or incomplete literal does not erase the rest of the document's colors.

`view!` introduces a separate markup state with tags, components, attributes, events, strings and prose. `{ ... }` islands return to Rust, including nested views. UI prose such as apostrophes, `·`, emoji and ampersands never reaches the strict Rust lexer for highlighting. Generic type arguments and comparisons outside a view are not parsed as markup. All rendered source and diagnostic messages are escaped; coloring and squiggles do not change font metrics.

Textarea line endings are normalized by the browser. `CodeEditor` keeps separate editor and original-source line maps, translates navigation and selections through line/UTF-16-column positions, and preserves uniform CRLF files when editing. Scanner token/depth budgets leave the remainder as uncolored original text rather than losing content. These budgets do not relax compiler acceptance rules.

## Semantic model and capability boundaries

| Feature | Browser Rust | Ferrite Rust UI | Connected native rust-analyzer |
| --- | --- | --- | --- |
| Tolerant syntax highlighting | Yes, including incomplete input | Rust + markup + expression islands | The same local editor scanner |
| Completion | Resolved visible locals and source functions; labelled syntax candidates on errors | UI tags, attributes, events, components and ABI functions, plus Rust candidates | Native completion results adapted to the same popup |
| Signatures | Source function signatures | Compiler-owned UI ABI plus source functions | Server-provided signature and active parameter |
| Hover/definition/references | Compiler-resolved project-local source | Original-source expressions, closures, helpers and components | Server-resolved project-local results |
| Rename preview | Resolved local bindings, with conservative collision checks | Same, including captured state and closure parameters | Server workspace edits restricted to supplied files |
| Live inline diagnostics | Browser compiler subset | Canonical UI parse/type/ownership analysis | Existing native/Cargo diagnostics remain native; subset diagnostics do not overwrite them |

Browser results are not a replacement for rust-analyzer's complete Rust/crate analysis. Function/module/import renames, external library source loading, snippets, server commands, and file-operation refactorings are not implemented by the browser language service. Unsupported compiler constructs still produce diagnostics. Lexical completion candidates are explicitly labelled and are never used to fabricate binding identities, definitions, references or rename edits. UI MIR emission is a compiler operation, not an editor-analysis result.

The service exposes LSP-shaped completion, hover, definition, references, signature help, diagnostics, semantic token full/range, document highlight, symbols, folding and hint methods for the existing browser agent/MCP tooling. It is an in-process browser service, not a new standalone JSON-RPC language-server transport. Semantic tokens use the exported legend and relative UTF-16 encoding, split across LF/CRLF boundaries without overlaps. UI render/debug behavior remains in the existing UI SDK.

`UIAnalysis` runs configuration, macro expansion, canonical type checking and ownership analysis off the main thread. It does not render the application, run callbacks, execute workspace code or emit artifacts. UI API signatures come directly from `RustAbi.UI_DECLARATIONS`, avoiding a separately maintained signature list. Completed semantic results are cached by exact file contents, options and revision. The editor disposes its workers/listeners, and the browser agent runtime disposes its independent UI analysis worker on disconnect.

`RustLanguageIndex` narrows all resolved locations against original-source tokens. Synthetic UI temporaries cannot create broad rename spans. Lowered `_captureN` environment fields are mapped back through the compiler closure-capture table: the counter view's declaration and three captured/direct uses remain four exact edits. Closing/opening component tags navigate to the resolved component function. Local completion respects the analyzed block scope and declaration position.

`CompletionEdits` handles both native and browser plain-text results: explicit text edits, insert/replace edits, CompletionList default ranges and `textEditText`, additional edits and full-token fallback replacement. It validates the transaction before showing or applying it. No completion command is executed. Source revision, workspace identity, epoch, focused file and caret leases prevent late responses from editing a newer document.

## Validation

```sh
npm run check
npm test
npm run test:editor-language
npm run test:browser
npm run test:ui:browser
```

The editor acceptance suite uses real Chromium input, popups, modal previews, worker compilation, file import, split editors and screenshots. Its normal/CI path serves the repository over HTTP and uses the production module worker. No native bridge, provider or model API is started by this suite.

For a restricted browser that cannot reach HTTP localhost, `FERRITE_MEMORY_TEST=1` uses the existing in-memory module loader. Because some opaque-origin environments also reject module workers, that test mode packs the **same UI-analysis source graph** into a classic worker with `tools/bundle-workers.mjs --entry src/ui/workers/ui-language-worker.js --stdout`. Results are not mocked, and the report explicitly records this delivery difference. That mode does not validate production HTTP/module-worker loading; the normal GitHub validation workflow does.
