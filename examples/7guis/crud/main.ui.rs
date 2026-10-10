mod model;
fn app() -> ui::Node {
    let people: ui::Signal<model::People> = ui::state_with(|| model::initial());
    let selected = ui::use_state(-1);
    let prefix = ui::use_string(""); let name = ui::use_string(""); let surname = ui::use_string("");
    let current = ui::read(people.clone()); let filter = ui::get_string(prefix.clone()); let selection = ui::get(selected.clone());
    let mut options: Vec<ui::Node> = Vec::new(); let mut selectable = false;
    for row in current.rows {
        if row.surname.starts_with(filter.as_str()) {
            if row.id as i64 == selection { selectable = true; }
            options.push(view! { <option key={row.id} value={row.id}>{row.surname.clone()}, {row.name.clone()}</option> });
        }
    }
    let filtering = { let prefix = prefix.clone(); let people = people.clone(); let selected = selected.clone(); move |input: String| {
        let data = ui::read(people.clone());
        if let Some(i) = model::index(&data.rows, ui::get(selected.clone())) { if !data.rows[i].surname.starts_with(input.as_str()) { ui::set(selected.clone(), -1); } }
        ui::set_string(prefix.clone(), input);
    } };
    let select = { let people = people.clone(); let selected = selected.clone(); let name = name.clone(); let surname = surname.clone(); move |input: String| {
        if let Ok(id) = input.parse::<i64>() { let data = ui::read(people.clone()); if let Some(i) = model::index(&data.rows, id) {
            ui::set(selected.clone(), id); ui::set_string(name.clone(), data.rows[i].name.clone()); ui::set_string(surname.clone(), data.rows[i].surname.clone());
        } }
    } };
    let set_name = { let name = name.clone(); move |text: String| ui::set_string(name.clone(), text) };
    let set_surname = { let surname = surname.clone(); move |text: String| ui::set_string(surname.clone(), text) };
    let create = { let people = people.clone(); let name = name.clone(); let surname = surname.clone(); move || { let next = model::create(ui::read(people.clone()), ui::get_string(name.clone()), ui::get_string(surname.clone())); ui::write(people.clone(), next); } };
    let update = { let people = people.clone(); let name = name.clone(); let surname = surname.clone(); let selected = selected.clone(); let prefix = prefix.clone(); move || {
        let last = ui::get_string(surname.clone()); let next = model::update(ui::read(people.clone()), ui::get(selected.clone()), ui::get_string(name.clone()), last.clone()); ui::write(people.clone(), next);
        if !last.starts_with(ui::get_string(prefix.clone()).as_str()) { ui::set(selected.clone(), -1); }
    } };
    let delete = { let people = people.clone(); let selected = selected.clone(); move || { ui::write(people.clone(), model::delete(ui::read(people.clone()), ui::get(selected.clone()))); ui::set(selected.clone(), -1); } };
    view! { <section className="task crud">
        <p className="eyebrow">05 / 7GUIs</p><h1>CRUD</h1>
        <label>Filter prefix<input aria-label="Filter prefix" value={filter} on:input={filtering} /></label>
        <div className="crud-body"><select aria-label="People" size="8" value={selection} on:change={select}>{options}</select><div><label>Name<input aria-label="Name" value={ui::get_string(name)} on:input={set_name} /></label><label>Surname<input aria-label="Surname" value={ui::get_string(surname)} on:input={set_surname} /></label></div></div>
        <div className="row"><button on:click={create}>Create</button><button disabled={!selectable} on:click={update}>Update</button><button disabled={!selectable} on:click={delete}>Delete</button></div>
    </section> }
}
