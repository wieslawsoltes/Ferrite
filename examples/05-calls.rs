fn print_twice<T: Display>(value: T) {
    println!("{}", value);
    println!("{}", value);
}
fn main() {
    print_twice("Ferrite");
    print_twice(100u32);
}