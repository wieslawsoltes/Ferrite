# IDE tool windows

Ferrite's outer workbench follows RustRover's new-UI tool-window organization:
a compact main toolbar, a permanent central editor, upper/lower sidebar groups,
individual tool-window title bars and six independently addressable positions.
The existing per-file Code / Split / Design / Preview editors and seven designer
panels keep their own document and docking state.

## Working with the layout

Project opens on the left and Cargo on the right. Bottom tools are closed until
requested. Use the upper sidebar icons for vertical tools and the lower icons
for horizontal bottom tools. Clicking the active icon hides that tool; it does
not replace it with a different tool from the same position. The title's chevron
selects another tool assigned to that position. **More Tool Windows** recovers
icons removed from the sidebar.

Drag a title or sidebar icon to any of **Left Top**, **Left Bottom**, **Right Top**,
**Right Bottom**, **Bottom Left** and **Bottom Right**. The six targets and live
rectangle show the resulting arrangement before committing. Dropping on a
sidebar icon inserts before it; dropping over the editor or outside a dock target
floats the tool. Escape, pointer cancellation or loss of window focus rolls back
the whole gesture. Two active positions on one side create a resizable split.

The title's options menu provides **Move to**, **View Mode**, maximize, hide and
sidebar removal. Double-click the title to maximize/restore. Edge and internal
split separators support pointer dragging, arrow keys, Shift for larger steps,
Home/End and double-click reset. Floating tools have a keyboard/pointer resize
handle and a **Dock** button.

View modes have distinct behavior:

- **Dock Pinned** reserves editor space and stays open when focus changes.
- **Dock Unpinned** reserves space while open and hides when focus leaves it.
- **Undock (Sliding)** overlays the editor without reserving space and hides on
  outside interaction.
- **Float** creates an independently movable, resizable browser-hosted tool.

The **Window Layout** button restores defaults, toggles all tools, switches
**Wide Screen Layout**, and saves/restores/deletes named arrangements. The default
bottom area spans the workbench; wide-screen mode keeps side tools full height
and the bottom area underneath the editor. Up to twenty named layouts are stored
per browser origin. They do not replace source documents or designer layouts.
**Main Menu → File** exposes the existing file/project/sample actions;
**Show Workspace Actions** restores the expanded secondary toolbar.

## Keyboard navigation

| Shortcut | Action |
| --- | --- |
| Alt+1 / 4 / 5 / 6 / 7 / 9 | Project / Run / Debugger / Problems / Structure / Repositories |
| Alt+F12 | Terminal |
| F12 | Open and focus the last active tool window |
| Escape | Return to the editor; unpinned/sliding tools also hide |
| Shift+Escape | Hide the active or last active tool window |
| Ctrl/Cmd+Shift+F12 | Hide / restore all tool windows |
| Ctrl/Cmd+Shift+Quote | Maximize / restore the active tool window |
| Shift+F10 | Sidebar context menu |
| Arrow keys / Home / End | Navigate sidebar icons or resize a focused separator |
| Ctrl/Cmd+B | Go to Rust definition (F12 is now tool-window focus) |

Terminal Escape and nested designer keyboard handlers retain priority. Browser
or operating-system reserved shortcuts may be intercepted before reaching a web
application; all docking actions also have visible menu controls.

## Retention and persistence

`ToolWindowState` owns registrations, slot order/selection, modes, sidebar
visibility, preferred sizes, split ratios and floating bounds. `ToolWindowGeometry`
projects that state into viewport rectangles without changing user preferences.
`ToolWindowInput` owns transactional pointer capture, previews and keyboard
commands. `ToolWindowSidebar` derives the icon positions from the same model.
`DockLayout` mounts every tool body once and updates only visibility and geometry.
Moving or floating a tool never reparents its iframe, terminal or designer body.
Floating tools and menus use the browser's top layer while retaining their DOM
parents. They are not separate native operating-system windows and do not offer
cross-browser-window or cross-monitor detachment.

The bounded `ferrite.layout.v4` record validates registrations and unique ownership
before restoration. Unknown removed tools are dropped, new registered tools are
added without stealing focus, invalid snapshots fall back atomically to defaults,
and malformed/disabled/quota-limited storage cannot prevent startup. Untouched
v3 laboratory defaults migrate to the new default; customized v3 positions,
visibility and widths survive. Named layouts use `ferrite.named-layouts.v1`.

On narrow viewports, side tools open as overlays rather than being permanently
converted to floating tools. Returning to the desktop restores the preferred
widths and positions. This is a browser adaptation, not a claim of pixel-identical
RustRover behavior on every platform.

## Validation

`npm test` includes model/geometry invariants, malformed migration, mode and
visibility transitions, bounded viewport projection and 10,000 deterministic
state transitions. `npm run test:docking:browser` exercises real pointer gestures,
all six targets, reorder, cancellation, split sizing, view modes, top-layer menus,
maximize, keyboard focus, named layouts, responsive behavior and retained DOM /
iframe identity. CI also exercises HTTP reload persistence and runs the existing
compiler, native Cargo, terminal/agent, language, designer, UI and sample suites.

Reference: [JetBrains RustRover user-interface guide](https://www.jetbrains.com/help/rust/guided-tour-around-the-user-interface.html).
