#[derive(Clone)]
pub struct Temperatures { pub celsius: String, pub fahrenheit: String }
pub fn initial() -> Temperatures { Temperatures { celsius: String::from(""), fahrenheit: String::from("") } }
pub fn change(mut state: Temperatures, input: String, celsius: bool) -> Temperatures {
    if celsius { state.celsius = input.clone(); } else { state.fahrenheit = input.clone(); }
    if let Ok(value) = input.trim().parse::<f64>() {
        let converted = if celsius { value * 9.0 / 5.0 + 32.0 } else { (value - 32.0) * 5.0 / 9.0 };
        if value.is_finite() && converted.is_finite() {
            if celsius { state.fahrenheit = converted.to_string(); } else { state.celsius = converted.to_string(); }
        }
    }
    state
}
