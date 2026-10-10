# Projects, files and document designers

## Start a UI project

Choose **Project** in the workspace toolbar, enter a name and select **Rust UI
application**. Ferrite creates a Cargo project plus `src/app.ui.rs`, its `.ui.json`
settings and `.ui.css` stylesheet. The new view opens in Split mode. Binary and
library projects are available in the same dialog without adding a UI view.

Use **UI View**, the Project header action or a folder's context menu to add another
view. Blank is the default; Counter, Form and Components are optional templates.
Existing source or sidecars are never overwritten by creation. Any `.ui.rs` file,
Rust file with a UI manifest, or Rust source containing `view!` can open a designer.

**Folder** opens the browser's directory picker and imports a bounded text snapshot.
The project switcher beside the Ferrite logo opens recent browser-local projects,
new projects, folder import, repository tools and snapshot import. A project is
archived before switching away; a storage quota error stops the switch rather than
silently losing the current source. Clicking the current recent project never rolls
it back to an older archive. Export snapshots for backups outside browser storage.

## Files and folders

The Project tree supports nested and empty folders, filtering, collapse/expand all,
reveal active file, context menus and keyboard navigation. New paths are relative
to the selected directory. **F2** renames/moves the selected path; **Delete** asks for
confirmation. Arrow keys navigate and expand folders. Drag a file or folder onto a
folder to move it; the same validated transaction serves drag/drop and dialogs.

Rename, move, duplicate and delete operate recursively. A view source rename also
moves its manifest and conventional unshared stylesheet; manifest `entryFile` and
`stylesheet` references follow the destination. Shared CSS remains shared. File
collisions, file/directory conflicts, traversal, moves into a descendant and deleting
the project's last file are rejected before the model changes.

Use **Undo file or workspace operation** in Search Everywhere to undo a tree change.
Tree undo preserves source, folders, tabs, positions, breakpoints and the dirty
baseline. It refuses to overwrite newer conflicting source edits. Closing a tab
does not delete or discard its source. File operations do not rewrite Rust `mod`
declarations, `#[path]` attributes, imports or Cargo target paths; adjust those
references separately. Semantic symbol rename remains the rust-analyzer command.

## Documents and splits

A single Project click opens a transient preview tab; double-click, explicit Open,
pin or editing keeps it open. Tab titles distinguish equal basenames using paths.
Tabs support drag reordering, middle-click close, context-menu pin/unpin, Close
Others, Close Tabs to the Right, Close All Unpinned and Reopen Closed Tab. Bulk close
preserves pinned tabs. Left/right, Home and End navigate a focused tab strip.

| Action | Shortcut |
| --- | --- |
| Search Everywhere | Ctrl/Cmd+Shift+P |
| Find a file | Ctrl/Cmd+P |
| New file / project | Ctrl/Cmd+N / Ctrl/Cmd+Shift+N |
| Close / reopen tab | Ctrl/Cmd+W / Ctrl/Cmd+Shift+T |
| Cycle tabs | Ctrl+Tab / Ctrl+Shift+Tab |
| Save browser workspace | Ctrl/Cmd+S |

Browsers may reserve some shortcuts; all operations also have buttons, menus or
Search Everywhere commands. Right-click a tab for **Split Right** or **Split Down**.
Ordinary files get a second editor with an independent file selector, cursor/scroll
position and undo history over the same live file model. **Unsplit** closes it.

## One designer per view file

The editor-level **Code / Split / Design / Preview** toolbar belongs to the active
document, not a global sample tool window. Code shows only source. Split shows source
and designer. Design shows the designer without code. Preview shows the running app
without structure and inspector panes. The split can be horizontal or vertical.
Drag its separator, use arrow keys (Shift for larger steps), or double-click/Home to
reset to 50 percent. The ratio is constrained to 20–80 percent.

Each open view owns its entry file, compilation generation, preview channel, iframe,
selection, CSS, settings and debugger state. Switching between views retains their
mounted runtime state rather than loading every tab into a shared iframe. Edits
invalidate only relevant entry/component/style dependencies; stale results cannot
replace a newer build. Returning to an invalidated view recompiles it. Visual edits
validate the complete candidate source before an atomic model update.

Selecting a rendered component can reveal a different source module while keeping
the entry view's preview, stylesheet and compilation ownership. Selecting another
view tab activates that view's own session. Up to 16 live sessions are retained;
closing a view or evicting an inactive session disposes its worker, listeners and
preview channel. Source and persisted document settings survive eviction, but live
application state does not survive eviction, rebuild, project switching or reload.

Structure and Toolbox occupy the left designer pane. The canvas occupies the center;
Properties, Styles and Debug are separate inspector tabs on the right. Pane toggles
and separators control space. The toolbox inserts source-backed elements, while
outline dragging reparents nodes. Pick element, attribute editing, literal geometry,
application state inspection and MIR event debugging use the existing source-aware
compiler/runtime services. Settings / Export holds entry/backend settings, standalone
HTML exports and trusted native Wasm import. There are no sample buttons in the
workspace toolbar or designer; templates live in the New UI View dialog.

At phone width, Code+Designer stacks vertically. Structure or Inspector can replace
the narrow canvas temporarily through their explicit toggle buttons. Tool windows
remain available from the existing docking rails.

## Persistence and execution boundaries

Browser-local workspace state includes files, empty folders, project name, active and
open tabs, pin/preview/closed-tab metadata, per-file modes/orientation/ratios, primary
editor positions and breakpoints. Portable project snapshots include files, folders
and name, not transient runtime state. The secondary ordinary-editor selection is
session-local. Designer internal pane widths/tabs are session-local too.

Folder imports do not grant implicit write-back, filesystem watching, binary asset
editing or arbitrary OS access. Use the existing authenticated native repository
integration for a real Cargo checkout and explicit command-time synchronization.
Recent browser projects restore source snapshots, not native checkout credentials.
Storage restrictions fall back to memory-only catalogs, not pretend persistence.

This workbench is independent of JetBrains and does not claim complete RustRover
feature compatibility. Browser compilation remains Ferrite's supported Rust subset;
full installed Cargo/rust-analyzer and native Wasm paths keep their existing explicit
trust and compatibility boundaries. See [Rust UI](rust-ui.md), [native Rust UI](native-rust-ui.md)
and [UI compatibility](ui-compatibility.md).

## Validation

`npm test` covers atomic operations, sidecar rewrites, collision rejection, tab
lifecycle, persistence, stale undo and quota failure. `npm run test:ui:browser` runs
the existing source/canvas/backend/export checks and `tools/ui-workspace-acceptance.py`.
The latter exercises actual project dialogs, independent live counters, file-owned
CSS, stale background edits, tab menus, folder/view moves, duplicate sidecars, ordinary
editor splits, project restoration, HTTP-origin reload and phone-width pane access.
CI uses real HTTP delivery. `FERRITE_MEMORY_TEST=1` is a restricted-container fallback
that executes the same modules but does not establish HTTP, OS picker or persistent
storage delivery guarantees. Screenshots/results are retained under `artifacts/`.
