# Designer docking and visual editing

## Arrange the workbench

Open a `.ui.rs` document and choose **Design** for the full workspace, or **Split**
for code alongside it. Structure, Toolbox, Canvas, Properties, Styles, Debug and
Settings / Export each have a draggable tab and their own panel actions.

Drag over a panel edge to split it, over its center to join its tab group, or over
a different tab to insert before it. The translucent guide describes the pending
operation. Drop outside the workbench to float; Escape cancels without changing the
saved layout. Double-click a tab or use its Float button to float/dock it. A floating
panel's corner grip resizes it. Hidden groups release space without losing their
position; **Panels → Show …** restores them. Every drag action also has an explicit
menu alternative, including **Relative to**, **Position**, and **Apply docking**.

**Focus canvas** temporarily maximizes the canvas; press it again to restore the
arrangement. Panel actions can maximize other panels. **Panels** also exposes Reset
designer layout, Wide canvas layout and Debug layout. Presets reset the layout, not
source files. Layouts belong to view documents and persist in the browser workspace.

## Edit source visually

Filter Structure by tag, text or attribute and select an item. Breadcrumbs above the
canvas navigate its ancestors. Pick element selects the corresponding source node
without activating the running application; Interact returns to normal application
input. Selecting a reusable component reveals its source while retaining the entry
view's preview and stylesheet. Old background preview messages cannot take over a
different document.

Search the Toolbox by component name/category/alias. Container, Row, Column, Grid,
Heading, Text, List, Button, Input, Label, Checkbox and Select insert source-backed
markup. The insertion selector chooses Inside, Before or After selection. Dragging
a toolbox item onto Structure chooses a parent directly. Void HTML elements cannot
contain children; use Before/After for those destinations.

Properties separates Content, Attributes, Absolute canvas rectangle and Children.
Literal text and attributes support Enter to apply. Repeated text edits remain
editable after source-safe string-literal rewriting. Dynamic expressions are never
evaluated to populate inspector fields. Geometry is not guessed: only
literal pixel values are projected, and unset or percentage values remain unset.
Move / Resize uses actual rendered bounds and writes explicit absolute CSS. Normal
flow, flex and grid layouts should use CSS or the Row/Column/Grid toolbox templates.
All visual edits pass through the compiler's candidate-source validation and stale
revision checks before replacing workspace text.

Styles edits this view's stylesheet. Debug retains state inspection and MIR event
stepping. Settings / Export contains entry selection, standalone/hydrated HTML export
and trusted native Wasm import. Native Cargo binaries retain inspection/export
support but are not falsely presented as editable browser-compiler source.

## Keyboard and narrow screens

| Focus | Keys |
| --- | --- |
| Panel tabs | Left/Right, Home/End select; Ctrl/Cmd plus those keys reorders |
| Panel tab | Shift+F10 opens actions; double-click toggles floating |
| Panel workspace | F6 / Shift+F6 cycles visible panels |
| Splitter | Arrow keys resize; Shift gives larger steps; Home/End use limits |
| Floating resize grip | Arrow keys resize; Shift gives larger steps |
| Panel menu or active drag | Escape closes/cancels; menu closure restores focus |
| Source outline | Arrows expand/collapse/navigate; Home/End; Enter selects |

Below 600 CSS pixels of designer width, one panel fills the available surface.
Use Panels to switch tools. This also makes side-by-side Code+Designer usable in a
narrow editor group. The desktop split tree is not overwritten when a screen narrows.

## Lifetime and boundaries

Panel bodies are mounted once. Docking, floating, grouping, hiding or maximizing
changes presentation without moving the iframe in the DOM, so running application
state and unfinished property inputs survive. Rebuilding source intentionally
replaces the preview; closing/evicting its session, changing projects or reloading
also resets runtime state. Layout persists independently of that runtime state.
Floating panels disappear when their document is inactive or in Code/Preview mode,
and return when its designer is visible again.

Floating panels are browser-viewport surfaces, not separate operating-system windows.
Designer groups are independent of the outer IDE tool-window docking regions; this
increment does not claim cross-document/outer-region docking or RustRover parity.
Browser storage quotas and privacy restrictions still apply. Persisted layouts are
validated for known/unique panel IDs, bounded geometry and a bounded split tree;
invalid saved layouts fall back to the default rather than losing source documents.

## Validation

`npm run test:designer:browser` runs the real Chromium docking suite; it is also part
of `npm run test:ui:browser` and the normal CI workflow. Assertions cover all seven
panels, pointer hit testing and cancellation, keyboard tab groups, iframe identity
and load count, runtime counters, property drafts, per-document ownership, compact
presentation, source-backed edits and HTTP-origin reload. The existing native/UI/
workspace suites remain enabled. Screenshots and JSON evidence are retained under
`artifacts/designer-docking`.

`FERRITE_MEMORY_TEST=1` is only a restricted-container fallback. It executes the same
modules and CSS through memory delivery. The identical UI-analysis source graph is
packed as a classic worker where opaque-origin module workers are blocked. This does
not establish HTTP/module-worker, filesystem or persistent browser-storage coverage;
CI exercises the default HTTP path.
