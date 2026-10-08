// Sample catalog: examples are intentionally constrained to the implemented Rust subset.
export const sampleProjects={
"Generics & modules":{
"Cargo.toml":'[package]\nname = "generic-modules"\nversion = "0.1.0"\nedition = "2021"\n',
"src/main.rs":'mod helpers;\nfn main() {\n    helpers::helpers_print(21u32);\n    helpers::helpers_print("Ferrite");\n}',
"src/helpers.rs":'pub fn helpers_print<T: Display>(value: T) {\n    println!("Value {}", value);\n}'},
"Control-flow and Fibonacci":{
"Cargo.toml":'[package]\nname = "fibonacci"\nversion = "0.1.0"\nedition = "2021"\n',
"src/main.rs":'fn fib(n: u32) -> u32 {\n    if n < 2u32 { return n; }\n    let mut a = 0u32;\n    let mut b = 1u32;\n    let mut i = 2u32;\n    while i <= n {\n        let next = a + b;\n        a = b;\n        b = next;\n        i += 1u32;\n    }\n    b\n}\nfn main() {\n    println!("fib(10) = {}", fib(10u32));\n}'},
"Arrays & conditions":{
"Cargo.toml":'[package]\nname = "arrays"\nversion = "0.1.0"\nedition = "2021"\n',
"src/main.rs":'fn main() {\n    let values = [5u32, 8u32, 13u32, 21u32];\n    let mut index = 0u32;\n    while index < 4u32 {\n        if values[index] > 10u32 {\n            println!("Large: {}", values[index]);\n        }\n        index += 1u32;\n    }\n}'},
"Generic call chain":{
"Cargo.toml":'[package]\nname = "generic-calls"\nversion = "0.1.0"\nedition = "2021"\n',
"src/main.rs":'fn inner<T: Display>(v: T) { println!("Inner {}", v); }\nfn middle<T: Display>(v: T) { inner(v); }\nfn outer<T: Display>(v: T) { middle(v); }\nfn main() {\n    outer("pipeline");\n    outer(123u32);\n}'},
"Boolean & arithmetic":{
"Cargo.toml":'[package]\nname = "boolean-math"\nversion = "0.1.0"\nedition = "2021"\n',
"src/main.rs":'fn compute(x: u32, y: u32) -> u32 {\n    if x > y && y > 0u32 { return x * y + 2u32; }\n    0u32\n}\nfn main() { println!("Result {}", compute(7u32, 4u32)); }'},
"Compiler diagnostic":{
"Cargo.toml":'[package]\nname = "diagnostics"\nversion = "0.1.0"\nedition = "2021"\n',
"src/main.rs":'fn print_number(value: u32) { println!("{}", value); }\nfn main() { print_number("this is not a number"); }'},
"Struct geometry":{
"Cargo.toml":'[package]\nname = "struct-geometry"\nversion = "0.1.0"\nedition = "2021"\n',
"src/main.rs":'struct Point { x: u32, y: u32 }\nfn area(size: Point) -> u32 { size.x * size.y }\nfn main() { let rectangle = Point { x: 7u32, y: 9u32 }; println!("Area {}", area(rectangle)); }'},
"Integer range iteration":{
"Cargo.toml":'[package]\nname = "range-iteration"\nversion = "0.1.0"\nedition = "2021"\n',
"src/main.rs":'fn main() { let mut sum = 0u32; for x in 1u32..=10u32 { sum += x; } println!("Sum {}", sum); }'},
"Nested ranges":{
"Cargo.toml":'[package]\nname = "nested-ranges"\nversion = "0.1.0"\nedition = "2021"\n',
"src/main.rs":'fn main() { for i in 1u32..3u32 { for j in 1u32..4u32 { println!("{} x {} = {}", i, j, i * j); } } }'},
"Pattern matching":{
"Cargo.toml":'[package]\nname = "pattern-matching"\nversion = "0.1.0"\nedition = "2021"\n',
"src/main.rs":'fn label(value: u32) -> u32 {\n    match value {\n        0u32 => 100u32,\n        1u32 => 200u32,\n        _ => 999u32,\n    }\n}\nfn main(){ for n in 0u32..4u32 { println!("{} => {}", n, label(n)); } }'}
};
