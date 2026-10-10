fn app() -> ui::Node {
    let count = ui::use_state(0);
    let increment = {
        let count = count.clone();
        move || ui::update(count.clone(), |n| n + 1)
    };
    view! {
        <section className="task compact">
            <p className="eyebrow">01 / 7GUIs</p>
            <h1>Counter</h1>
            <div className="row">
                <input
                    aria-label="Count"
                    readOnly={true}
                    value={ui::get(count)}
                />
                <button on:click={increment}>Count</button>
            </div>
        </section>
    }
}
