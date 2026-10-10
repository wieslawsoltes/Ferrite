use crate::model;
// Reusable spreadsheet view; the domain parser and dependency engine stay in model.rs.
#[derive(Clone)]
pub struct GridProps {
    pub sheet: ui::Signal<model::Sheet>,
}

fn commit(sheet: ui::Signal<model::Sheet>, editing: ui::State, editor_ref: ui::Ref) {
    let index = ui::get(editing.clone());
    if index >= 0 {
        ui::set(editing, -1);
        let text = ui::ref_value(editor_ref);
        ui::write(sheet.clone(), model::set(ui::read(sheet), index as usize, text));
    }
}

pub fn Grid(props: GridProps) -> ui::Node {
    let sheet = props.sheet;
    let selected = ui::use_state(0);
    let editing = ui::use_state(-1);
    let draft = ui::use_string("");
    let editor_ref = ui::use_ref();
    let cell_ref = ui::use_ref();
    let data = ui::read(sheet.clone());
    let active = ui::get(editing.clone());
    let selection = ui::get(selected.clone());
    let focus = {
        let editing = editing.clone();
        let editor_ref = editor_ref.clone();
        let cell_ref = cell_ref.clone();
        move || {
            if ui::get(editing.clone()) >= 0 {
                ui::focus(editor_ref.clone());
            } else {
                ui::focus(cell_ref.clone());
            }
        }
    };
    ui::effect(focus, || {}, format!("{}:{}", active, selection).as_str());
    let mut headers: Vec<ui::Node> = Vec::new();
    for col in 0_usize..26 {
        let mut text = String::new();
        text.push((65_usize + col) as u8 as char);
        headers.push(view! {
            <th
                key={col}
                scope="col"
            >
                {text}
            </th>
        });
    }
    let mut rows: Vec<ui::Node> = Vec::new();
    for row in 0_usize..100 {
        let mut columns: Vec<ui::Node> = Vec::new();
        for col in 0_usize..26 {
            let index = row * 26 + col;
            let name = model::label(index);
            let choose = {
                let selected = selected.clone();
                move || ui::set(selected.clone(), index as i64)
            };
            let begin = {
                let sheet = sheet.clone();
                let selected = selected.clone();
                let editing = editing.clone();
                let draft = draft.clone();
                move |_value: String| {
                    let value = ui::read(sheet.clone());
                    ui::set(selected.clone(), index as i64);
                    ui::set_string(draft.clone(), value.cells[index].source.clone());
                    ui::set(editing.clone(), index as i64);
                }
            };
            let keyboard = {
                let sheet = sheet.clone();
                let selected = selected.clone();
                let editing = editing.clone();
                let draft = draft.clone();
                move |e: ui::Event| {
                    if ui::get(editing.clone()) < 0 {
                        let key = e.key;
                        let current = index as i64;
                        if key == "Enter" || key == "F2" {
                            ui::prevent_default();
                            let value = ui::read(sheet.clone());
                            ui::set_string(draft.clone(), value.cells[index].source.clone());
                            ui::set(editing.clone(), index as i64);
                        } else if key == "ArrowRight" {
                            ui::prevent_default();
                            if current % 26 < 25 {
                                ui::set(selected.clone(), current + 1);
                            }
                        } else if key == "ArrowLeft" {
                            ui::prevent_default();
                            if current % 26 > 0 {
                                ui::set(selected.clone(), current - 1);
                            }
                        } else if key == "ArrowDown" {
                            ui::prevent_default();
                            if current < 2574 {
                                ui::set(selected.clone(), current + 26);
                            }
                        } else if key == "ArrowUp" {
                            ui::prevent_default();
                            if current >= 26 {
                                ui::set(selected.clone(), current - 26);
                            }
                        }
                    }
                }
            };
            let content = if active == index as i64 {
                // Keep uncommitted typing in the native input: no 2,600-cell render per key.
                let finish = {
                    let sheet = sheet.clone();
                    let editing = editing.clone();
                    let editor_ref = editor_ref.clone();
                    move |_value: String| commit(sheet.clone(), editing.clone(), editor_ref.clone())
                };
                let keys = {
                    let sheet = sheet.clone();
                    let editing = editing.clone();
                    let editor_ref = editor_ref.clone();
                    move |e: ui::Event| {
                        if e.key == "Enter" {
                            ui::prevent_default();
                            ui::stop_propagation();
                            commit(sheet.clone(), editing.clone(), editor_ref.clone());
                        } else if e.key == "Escape" {
                            ui::prevent_default();
                            ui::stop_propagation();
                            ui::set(editing.clone(), -1);
                        }
                    }
                };
                view! {
                    <input
                        ref={editor_ref.clone()}
                        aria-label={format!("Edit {}", name)}
                        defaultValue={ui::get_string(draft.clone())}
                        on:blur={finish}
                        on_event:keydown={keys}
                    />
                }
            } else {
                view! {
                    <span>{data.cells[index].display.clone()}</span>
                }
            };
            let cell = view! {
                <td
                    key={index}
                    role="gridcell"
                    aria-label={name.clone()}
                    aria-selected={selection == index as i64}
                    data-cell={name.clone()}
                    className={
                        if data.cells[index].error != 0 {
                            "cell-error"
                        } else {
                            ""
                        }
                    }
                    tabindex={
                        if selection == index as i64 {
                            "0"
                        } else {
                            "-1"
                        }
                    }
                    title={data.cells[index].source.clone()}
                    on:click={choose}
                    on:dblclick={begin}
                    on_event:keydown={keyboard}
                >
                    {content}
                </td>
            };
            columns.push(if selection == index as i64 {
                ui::node_ref(cell, cell_ref.clone())
            } else {
                cell
            });
        }
        rows.push(view! {
            <tr key={row}>
                <th scope="row">{row}</th>
                {columns}
            </tr>
        });
    }
    view! {
        <div className="sheet-view">
            <div className="formula-display">
                <strong>{model::label(selection as usize)}</strong>
                <code aria-label="Selected formula">
                    {data.cells[selection as usize].source.clone()}
                </code>
                <span data-evaluations={data.evaluations}>{data.evaluations} cells recalculated</span>
            </div>
            <div className="sheet-scroll">
                <table
                    role="grid"
                    aria-label="Spreadsheet"
                    aria-rowcount="101"
                    aria-colcount="27"
                >
                    <thead>
                        <tr>
                            <th></th>
                            {headers}
                        </tr>
                    </thead>
                    <tbody>{rows}</tbody>
                </table>
            </div>
        </div>
    }
}
