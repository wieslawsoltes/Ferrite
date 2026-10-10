mod model;

#[derive(Clone, Copy)]
struct Menu {
    index: i64,
    x: f64,
    y: f64,
}

#[derive(Clone, Copy)]
struct Editor {
    index: i64,
    original: f64,
}

fn app() -> ui::Node {
    let drawing: ui::Signal<model::Drawing> = ui::state_with(|| model::initial());
    let selected = ui::use_state(-1);
    let menu = ui::state(Menu {
        index: -1,
        x: 0.0,
        y: 0.0,
    });
    let editor = ui::state(Editor {
        index: -1,
        original: 0.0,
    });
    let slider = ui::use_ref();
    let current = ui::read(drawing.clone());
    let editing = ui::read(editor.clone());
    let popup = ui::read(menu.clone());
    let hovering = {
        let drawing = drawing.clone();
        let selected = selected.clone();
        let editor = editor.clone();
        let menu = menu.clone();
        move |e: ui::Event| {
            if ui::read(editor.clone()).index < 0 && ui::read(menu.clone()).index < 0 {
                let data = ui::read(drawing.clone());
                ui::set(selected.clone(), model::nearest(&data.circles, e.offset_x, e.offset_y));
            }
        }
    };
    let leaving = {
        let selected = selected.clone();
        let editor = editor.clone();
        let menu = menu.clone();
        move |_value: String| {
            if ui::read(editor.clone()).index < 0 && ui::read(menu.clone()).index < 0 {
                ui::set(selected.clone(), -1);
            }
        }
    };
    let clicking = {
        let drawing = drawing.clone();
        let selected = selected.clone();
        let editor = editor.clone();
        let menu = menu.clone();
        move |e: ui::Event| {
            if ui::read(editor.clone()).index < 0 && e.button == 0 {
                ui::write(
                    menu.clone(),
                    Menu {
                        index: -1,
                        x: 0.0,
                        y: 0.0,
                    },
                );
                let state = ui::read(drawing.clone());
                let hit = model::nearest(&state.circles, e.offset_x, e.offset_y);
                if hit < 0 {
                    let index = state.circles.len();
                    ui::write(drawing.clone(), model::create(state, e.offset_x, e.offset_y));
                    ui::set(selected.clone(), index as i64);
                } else {
                    ui::set(selected.clone(), hit);
                }
            }
        }
    };
    let context = {
        let drawing = drawing.clone();
        let selected = selected.clone();
        let editor = editor.clone();
        let menu = menu.clone();
        move |e: ui::Event| {
            ui::prevent_default();
            if ui::read(editor.clone()).index < 0 {
                let data = ui::read(drawing.clone());
                let hit = model::nearest(&data.circles, e.offset_x, e.offset_y);
                ui::set(selected.clone(), hit);
                let left = if e.offset_x > 430.0 {
                    430.0
                } else {
                    e.offset_x
                };
                let top = if e.offset_y > 290.0 {
                    290.0
                } else {
                    e.offset_y
                };
                ui::write(
                    menu.clone(),
                    Menu {
                        index: hit,
                        x: left,
                        y: top,
                    },
                );
            }
        }
    };
    let adjust = {
        let drawing = drawing.clone();
        let editor = editor.clone();
        let menu = menu.clone();
        move || {
            let index = ui::read(menu.clone()).index;
            let state = ui::read(drawing.clone());
            if index >= 0 && (index as usize) < state.circles.len() {
                ui::write(
                    editor.clone(),
                    Editor {
                        index,
                        original: state.circles[index as usize].diameter,
                    },
                );
            }
            ui::write(
                menu.clone(),
                Menu {
                    index: -1,
                    x: 0.0,
                    y: 0.0,
                },
            );
        }
    };
    let resize = {
        let drawing = drawing.clone();
        let editor = editor.clone();
        move |text: String| {
            if let Ok(value) = text.parse::<f64>() {
                ui::write(
                    drawing.clone(),
                    model::preview(
                        ui::read(drawing.clone()),
                        ui::read(editor.clone()).index,
                        value,
                    ),
                );
            }
        }
    };
    let close = {
        let drawing = drawing.clone();
        let editor = editor.clone();
        move || {
            let active = ui::read(editor.clone());
            ui::write(
                drawing.clone(),
                model::finish(ui::read(drawing.clone()), active.index, active.original),
            );
            ui::write(
                editor.clone(),
                Editor {
                    index: -1,
                    original: 0.0,
                },
            );
        }
    };
    let escape = {
        let drawing = drawing.clone();
        let editor = editor.clone();
        let menu = menu.clone();
        move |e: ui::Event| {
            if e.key == "Escape" {
                ui::prevent_default();
                let active = ui::read(editor.clone());
                ui::write(
                    drawing.clone(),
                    model::finish(ui::read(drawing.clone()), active.index, active.original),
                );
                ui::write(
                    editor.clone(),
                    Editor {
                        index: -1,
                        original: 0.0,
                    },
                );
                ui::write(
                    menu.clone(),
                    Menu {
                        index: -1,
                        x: 0.0,
                        y: 0.0,
                    },
                );
            }
        }
    };
    let undo = {
        let drawing = drawing.clone();
        let selected = selected.clone();
        let menu = menu.clone();
        move || {
            ui::write(drawing.clone(), model::undo(ui::read(drawing.clone())));
            ui::set(selected.clone(), -1);
            ui::write(
                menu.clone(),
                Menu {
                    index: -1,
                    x: 0.0,
                    y: 0.0,
                },
            );
        }
    };
    let redo = {
        let drawing = drawing.clone();
        let selected = selected.clone();
        move || {
            ui::write(drawing.clone(), model::redo(ui::read(drawing.clone())));
            ui::set(selected.clone(), -1);
        }
    };
    let focus = {
        let slider = slider.clone();
        let editor = editor.clone();
        move || {
            if ui::read(editor.clone()).index >= 0 {
                ui::focus(slider.clone());
            }
        }
    };
    ui::effect(focus, || {}, format!("{}", editing.index).as_str());
    let mut shapes: Vec<ui::Node> = Vec::new();
    for i in 0_usize..current.circles.len() {
        let circle = current.circles[i];
        shapes.push(view! {
            <circle
                key={i}
                data-circle={i}
                cx={circle.x}
                cy={circle.y}
                r={circle.diameter / 2.0}
                fill={
                    if ui::get(selected.clone()) == i as i64 {
                        "#b7c2d4"
                    } else {
                        "none"
                    }
                }
                stroke="#25334a"
                stroke-width="1.5"
            />
        });
    }
    let diameter = if editing.index >= 0 {
        current.circles[editing.index as usize].diameter
    } else {
        30.0
    };
    let context_view = if popup.index >= 0 {
        view! {
            <div
                className="circle-menu"
                role="menu"
                style={format!("left:{}%;top:{}%", popup.x / 6.0, popup.y / 3.4)}
            >
                <button
                    role="menuitem"
                    on:click={adjust}
                >
                    Adjust diameter
                </button>
            </div>
        }
    } else {
        view! {
            <span hidden={true}></span>
        }
    };
    let dialog = if editing.index >= 0 {
        view! {
            <div className="dialog-shade">
                <section
                    role="dialog"
                    aria-modal="true"
                    aria-label="Adjust diameter"
                    className="diameter-dialog"
                >
                    <h2>Adjust diameter</h2>
                    <p>Changes preview live. Closing creates one undoable edit.</p>
                    <label>
                        Diameter
                        <input
                            ref={slider}
                            aria-label="Diameter"
                            type="range"
                            min="1"
                            max="200"
                            step="1"
                            value={diameter}
                            on:input={resize}
                        />
                    </label>
                    <output>{diameter}</output>
                    <button on:click={close}>Close</button>
                </section>
            </div>
        }
    } else {
        view! {
            <span hidden={true}></span>
        }
    };
    view! {
        <section
            className="task circle-task"
            on_event:keydown={escape}
        >
            <p className="eyebrow">06 / 7GUIs</p>
            <h1>Circle Drawer</h1>
            <div className="row">
                <button
                    disabled={current.cursor == 0 || editing.index >= 0}
                    on:click={undo}
                >
                    Undo
                </button>
                <button
                    disabled={current.cursor >= current.history.len() || editing.index >= 0}
                    on:click={redo}
                >
                    Redo
                </button>
                <span>{current.circles.len()} circles</span>
            </div>
            <div className="circle-stage">
                <svg
                    tabindex="0"
                    aria-label="Circle canvas"
                    viewBox="0 0 600 340"
                    on_event:click={clicking}
                    on_event:mousemove={hovering}
                    on:mouseleave={leaving}
                    on_event:contextmenu={context}
                >
                    {shapes}
                </svg>
                {context_view}
            </div>
            <p className="hint">
                Click empty space to add a circle. Hover selects the nearest containing circle.
                Right-click it to adjust its diameter.
            </p>
            {dialog}
        </section>
    }
}
