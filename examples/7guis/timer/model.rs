#[derive(Clone)]
pub struct Timer { pub elapsed: f64, pub duration: f64 }
pub fn tick(mut timer: Timer, milliseconds: f64) -> Timer {
    if timer.elapsed < timer.duration && milliseconds.is_finite() && milliseconds > 0.0 {
        timer.elapsed = timer.elapsed + milliseconds / 1000.0;
        if timer.elapsed > timer.duration { timer.elapsed = timer.duration; }
    }
    timer
}
