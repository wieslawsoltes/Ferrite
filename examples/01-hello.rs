fn greet<T: Display>(value: T) {
    println!("Hello, {}!", value);
}
fn main() {
    greet("World");
    greet(42u32);
}