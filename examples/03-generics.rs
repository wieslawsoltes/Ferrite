fn show<T: Display>(item: T) {
    println!("Value: {}", item);
}
fn main() {
    show("Rust");
    show(27u32);
    show(3.5f64);
}