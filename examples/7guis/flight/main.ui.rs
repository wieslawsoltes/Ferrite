mod model;
fn app() -> ui::Node {
    let returning = ui::use_bool(false);
    let start = ui::use_string("10.10.2026");
    let end = ui::use_string("10.10.2026");
    let message = ui::use_string("");
    let is_return = ui::get_bool(returning.clone());
    let first = ui::get_string(start.clone());
    let last = ui::get_string(end.clone());
    let valid_start = model::date(first.clone()).is_some();
    let valid_end = !is_return || model::date(last.clone()).is_some();
    let allowed = model::allowed(first.clone(), last.clone(), is_return);
    let mode = { let returning = returning.clone(); let message = message.clone(); move |text: String| { ui::set_bool(returning.clone(), text == "return"); ui::set_string(message.clone(), String::from("")); } };
    let set_start = { let start = start.clone(); let message = message.clone(); move |text: String| { ui::set_string(start.clone(), text); ui::set_string(message.clone(), String::from("")); } };
    let set_end = { let end = end.clone(); let message = message.clone(); move |text: String| { ui::set_string(end.clone(), text); ui::set_string(message.clone(), String::from("")); } };
    let book = { let message = message.clone(); move || {
        if model::allowed(ui::get_string(start.clone()), ui::get_string(end.clone()), ui::get_bool(returning.clone())) {
            let text = if ui::get_bool(returning.clone()) { format!("You have booked a return flight from {} to {}.", ui::get_string(start.clone()), ui::get_string(end.clone())) } else { format!("You have booked a one-way flight on {}.", ui::get_string(start.clone())) };
            ui::set_string(message.clone(), text);
        }
    } };
    view! { <section className="task compact">
        <p className="eyebrow">03 / 7GUIs</p><h1>Flight Booker</h1>
        <label>Flight type<select aria-label="Flight type" value={if is_return { "return" } else { "one-way" }} on:change={mode}><option value="one-way">one-way flight</option><option value="return">return flight</option></select></label>
        <label>Departure<input aria-label="Departure date" placeholder="dd.mm.yyyy" aria-invalid={!valid_start} value={first} on:input={set_start} /></label>
        <label>Return<input aria-label="Return date" placeholder="dd.mm.yyyy" disabled={!is_return} aria-invalid={!valid_end} value={last} on:input={set_end} /></label>
        <button disabled={!allowed} on:click={book}>Book</button>
        <p role="status">{ui::get_string(message)}</p>
        <p className="hint">Dates use dd.mm.yyyy. Return cannot precede departure.</p>
    </section> }
}
