/** Small portable sources: no dependencies and no network access. */
export const UI_SAMPLES = Object.freeze({
  counter: `fn app() -> ui::Node {
    let count = ui::use_state(0);
    view! {
        <section className="card">
            <p className="eyebrow">FERRITE / RUST UI</p>
            <h1>A little Rust. A living interface.</h1>
            <p>Edit this source or select an element in the designer.</p>
            <div className="counter">
                <button
                    aria-label="Decrease"
                    on:click={move || ui::update(count, |n| n - 1)}
                >
                    -
                </button>
                <output>{ui::get(count)}</output>
                <button
                    aria-label="Increase"
                    on:click={move || ui::update(count, |n| n + 1)}
                >
                    +
                </button>
            </div>
            <p className="footnote">Typed events · keyed DOM · JavaScript / Wasm / MIR</p>
        </section>
    }
}
`,
  form: `fn app() -> ui::Node {
    let name = ui::use_string("Rust");
    let input = ui::use_ref();
    view! {
        <section className="card">
            <p className="eyebrow">CONTROLLED INPUT / OWNED CAPTURES</p>
            <h1>Hello, {ui::get_string(name)}!</h1>
            <label htmlFor="name">Your name</label>
            <input
                id="name"
                ref={input}
                value={ui::get_string(name)}
                on:input={move |value: String| ui::set_string(name, value)}
            />
            <button on:click={move || ui::focus(input)}>Focus input</button>
        </section>
    }
}
`,
  components: `#[derive(Clone, Copy)]
struct CardProps {
    title: &'static str,
    initial: i64,
}

fn Card(props: CardProps) -> ui::Node {
    let count = ui::use_state(props.initial);
    view! {
        <article className="card">
            <h2>{props.title}</h2>
            <button on:click={move || ui::update(count, |n| n + 1)}>{ui::get(count)}</button>
        </article>
    }
}

fn app() -> ui::Node {
    view! {
        <section className="cards">
            <Card
                key="left"
                props={
                    CardProps {
                        title: "Independent state",
                        initial: 1,
                    }
                }
            />
            <Card
                key="right"
                props={
                    CardProps {
                        title: "Typed props",
                        initial: 10,
                    }
                }
            />
        </section>
    }
}
`
});
export const UI_SAMPLE_CSS = `body {
    background: #eef2f7;
    color: #162233;
    padding: 24px;
}

button,
input {
    border: 1px solid #cad3e0;
    border-radius: 8px;
    padding: 9px 14px;
    background: #fff;
    color: inherit;
}

button {
    cursor: pointer;
}

button:hover {
    background: #e5edff;
}

button:focus-visible,
input:focus-visible {
    outline: 3px solid #4679e9;
    outline-offset: 2px;
}

.card {
    max-width: 680px;
    margin: 20px auto;
    padding: 28px;
    border-radius: 18px;
    background: white;
    box-shadow: 0 12px 48px #26395612;
}

.eyebrow {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 2px;
    color: #5d6e88;
}

h1 {
    font-size: 30px;
    letter-spacing: -1px;
    line-height: 1.15;
}

p {
    line-height: 1.6;
    color: #65738b;
}

.counter {
    display: flex;
    gap: 22px;
    align-items: center;
    margin: 30px 0;
}

.counter button {
    font-size: 22px;
    width: 48px;
    height: 48px;
}

output {
    font-size: 44px;
    font-weight: 700;
    min-width: 70px;
    text-align: center;
}

.footnote {
    font-size: 11px;
}

label,
input {
    display: block;
    margin: 12px 0;
}

.cards {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
}

.cards>.card {
    flex: 1;
    min-width: 180px;
}

@media(max-width:480px) {
    body {
        padding: 10px;
    }
    .card {
        padding: 20px;
    }
    h1 {
        font-size: 24px;
    }
}
`;
