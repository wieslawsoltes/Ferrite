mod model;

fn app() -> ui::Node {
    let state = ui::state(model::Timer {
        elapsed: 0.0,
        duration: 10.0,
    });
    let ticking = {
        let state = state.clone();
        move |delta: f64| {
            let old = ui::read(state.clone());
            if old.elapsed < old.duration {
                ui::write(state.clone(), model::tick(old, delta));
            }
        }
    };
    ui::interval(25, ticking);
    let current = ui::read(state.clone());
    let duration = {
        let state = state.clone();
        move |input: String| {
            if let Ok(value) = input.parse::<f64>() {
                if value.is_finite() && value >= 0.0 && value <= 30.0 {
                    let mut next = ui::read(state.clone());
                    next.duration = value;
                    ui::write(state.clone(), next);
                }
            }
        }
    };
    let reset = {
        let state = state.clone();
        move || {
            let mut next = ui::read(state.clone());
            next.elapsed = 0.0;
            ui::write(state.clone(), next);
        }
    };
    let progress = if current.duration == 0.0 {
        1.0
    } else if current.elapsed >= current.duration {
        1.0
    } else {
        current.elapsed / current.duration
    };
    view! {
        <section className="task compact">
            <p className="eyebrow">04 / 7GUIs</p>
            <h1>Timer</h1>
            <label>
                Elapsed time
                <progress
                    aria-label="Elapsed time"
                    max="1"
                    value={progress}
                />
            </label>
            <output aria-label="Elapsed seconds">{(current.elapsed * 10.0).floor() / 10.0}</output>
            <span> seconds</span>
            <label>Duration: {current.duration} seconds<input
                aria-label="Duration"
                type="range"
                min="0"
                max="30"
                step="0.1"
                value={current.duration}
                on:input={duration}
            /></label>
            <button on:click={reset}>Reset</button>
            <p className="hint">
                Change duration while running. Extending a completed timer resumes it.
            </p>
        </section>
    }
}
