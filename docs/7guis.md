# 7GUIs samples (implementation in progress)

This branch implements the [7GUIs task specification](https://eugenkiss.github.io/7guis/tasks/) as editable Rust/view! projects, not as JavaScript widgets hidden behind Rust facades.

## Acceptance contracts

- Counter starts at zero and increments once per activation.
- Temperature Converter starts with two empty fields. Valid numeric input updates the opposite field; invalid input preserves its previous value.
- Flight Booker uses one-way/return mode, strict calendar dates, disabled return input in one-way mode, invalid-field feedback, constrained booking and an explicit confirmation.
- Timer uses elapsed-time signals, live duration changes, pause at the duration, resume after extension and reset. Its scheduler is disposed with the component.
- CRUD maintains stable record identity under immediate surname-prefix filtering and enables update/delete only for a selected record.
- Circle Drawer selects the nearest containing circle, creates in empty space, opens a context-menu diameter editor, previews changes live and records one undoable action when editing closes. New actions invalidate redo.
- Cells provides a scrollable A–Z by 0–99 grid, editable formulas, parsing, errors and dependency-based recalculation. The model and reusable view are separate; unrelated cells are not reevaluated.

## IDE integration

Samples must be browsable from the application with search/category metadata and source files. Opening a sample must not silently discard the current project. Adding samples to an existing project must not overwrite existing source or sidecars. Each view uses the existing document tabs, Code/Split/Design/Preview, source editor, debugger and single-file HTML export.

## Merge gate

The final head must pass the repository compiler/runtime tests and real browser acceptance for all seven tasks, sample browsing, project preservation, framework lifetimes and offline export. Compiler and host additions need JavaScript/MIR/Wasm regression coverage. Record actual validation results and remaining execution boundaries here before merging.
