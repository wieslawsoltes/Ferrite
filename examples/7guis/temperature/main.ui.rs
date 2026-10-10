mod model;
fn app() -> ui::Node {
    let state: ui::Signal<model::Temperatures> = ui::state_with(|| model::initial());
    let current = ui::read(state.clone());
    let celsius = { let state = state.clone(); move |text: String| ui::modify(state.clone(), move |old| model::change(old, text.clone(), true)) };
    let fahrenheit = { let state = state.clone(); move |text: String| ui::modify(state.clone(), move |old| model::change(old, text.clone(), false)) };
    view! { <section className="task">
        <p className="eyebrow">02 / 7GUIs</p><h1>Temperature Converter</h1>
        <div className="row"><label>Celsius<input aria-label="Celsius" inputMode="decimal" value={current.celsius.clone()} on:input={celsius} /></label><span>=</span><label>Fahrenheit<input aria-label="Fahrenheit" inputMode="decimal" value={current.fahrenheit.clone()} on:input={fahrenheit} /></label></div>
        <p className="hint">Both fields are editable. Incomplete or invalid input leaves the other field unchanged.</p>
    </section> }
}
