mod model;
mod grid;
use grid::Grid;

fn app() -> ui::Node {
    let sheet: ui::Signal<model::Sheet> = ui::state_with(|| model::initial());
    view! {
        <section className="task cells-task">
            <p className="eyebrow">07 / 7GUIs</p>
            <h1>Cells</h1>
            <p className="hint">
                Double-click a cell or press Enter to edit. Enter commits, Escape cancels, arrows
                navigate. Formulas start with =.
            </p>
            <Grid
                props={
                    grid::GridProps {
                        sheet: sheet.clone(),
                    }
                }
            />
            <p className="hint">
                Examples: =A0+2, =sum(A0:B9), =div(12,3). Functions: add, sub, mul, div, mod, sum,
                prod, avg, count, min, max. Text and empty cells are preserved.
            </p>
        </section>
    }
}
