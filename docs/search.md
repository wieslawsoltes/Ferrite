# Find and replace across a workspace

Open **Find in Files** from the tool rail or the command palette. `Ctrl/Cmd+Shift+F`
and `Ctrl/Cmd+Shift+H` search the project; `Ctrl/Cmd+F` and `Ctrl/Cmd+H` restrict the
search to the active file. Selected source text prefills the query. The tool can
be docked, floated and resized like the compiler or debugger.

The search is literal, with optional Unicode case-insensitive and whole-word
matching. Regular-expression metacharacters are escaped, and replacement `$`
sequences remain literal. Use the native rust-analyzer Rename command when the
intent is a semantic symbol rename rather than a textual replacement.

Comma-separated file masks support `*` and `?` within a path segment and `**`
across directories. `**/` also matches zero directories. Include and exclude
masks are evaluated with a non-backtracking state machine. Results preserve
original UTF-16 offsets and highlight exactly the source that was searched.

Every search is bound to a workspace revision. Editing, renaming, adding or
removing a file invalidates both navigation results and a replacement preview.
Search scheduling cancels superseded requests and yields between work slices.
The view caps results at 2,000; a truncated result cannot be used for Replace All.

**Preview replacements** does not change source. **Apply replacements** verifies
that the revision and every original source match, validates the project text
limit, and applies all changed files as one transaction. Expansion is bounded
before strings are concatenated. **Undo replacement** uses the workspace edit
transaction stack and refuses to overwrite intervening edits to affected files.
The editor drops obsolete per-document undo snapshots when an external
transaction replaces a document.

The initial preview renders at most 25,000 characters of each before/after file.
This is a display limit only; the complete validated edits are applied. Empty
queries do not create zero-length replacements. Search and preview state are
not part of exported project snapshots.

Components: `FileMask`, `WorkspaceSearch`, `ReplacePlan`, `SearchView`.
Tests: `tests/workspace-search.test.js` and the HTTP browser acceptance suite.
