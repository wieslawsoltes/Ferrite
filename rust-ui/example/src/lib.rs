use ferrite_ui::{self as ui, view};

// This uses standard rustc's generics, closures, standard collections and modules.
#[derive(Clone)]
struct Model { count: i64, labels: std::collections::BTreeMap<String,String> }
fn app() -> ui::Node {
    let model = ui::state_with(|| Model { count: 0, labels: [("title".into(),"Native Rust UI".into())].into() });
    let name = ui::state(String::from("Ada"));
    let clicked = model.clone(); let changed = name.clone();
    let reference=ui::use_ref();
    view! {
        <section className="card">
            <h1>{model.get().labels["title"].clone()}</h1>
            <output id="count">{model.get().count}</output>
            <button id="increment" on:click={move || clicked.update(|mut m| {m.count+=1;m})}>"Increase"</button>
            <input id="name" value={name.get()} ref={reference} on:input={move |value| changed.set(value)} />
            <p id="greeting">{format!("Hello, {}", name.get())}</p>
            <button id="focus" on:click={move || ui::focus(reference)}>"Focus input"</button>
        </section>
    }
}
ui::export_app!(app);
