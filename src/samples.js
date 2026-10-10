// Sample catalog: examples are intentionally constrained to the implemented Rust subset.
export const sampleProjects={
"Generics & modules":{
"Cargo.toml":'[package]\nname = "generic-modules"\nversion = "0.1.0"\nedition = "2021"\n',
"src/main.rs":`mod helpers;

fn main() {
    helpers::helpers_print(21u32);
    helpers::helpers_print("Ferrite");
}
`,
"src/helpers.rs":`pub fn helpers_print<T: Display>(value: T) {
    println!("Value {}", value);
}
`},
"Control-flow and Fibonacci":{
"Cargo.toml":'[package]\nname = "fibonacci"\nversion = "0.1.0"\nedition = "2021"\n',
"src/main.rs":`fn fib(n: u32) -> u32 {
    if n < 2u32 {
        return n;
    }
    let mut a = 0u32;
    let mut b = 1u32;
    let mut i = 2u32;
    while i <= n {
        let next = a + b;
        a = b;
        b = next;
        i += 1u32;
    }
    b
}

fn main() {
    println!("fib(10) = {}", fib(10u32));
}
`},
"Arrays & conditions":{
"Cargo.toml":'[package]\nname = "arrays"\nversion = "0.1.0"\nedition = "2021"\n',
"src/main.rs":`fn main() {
    let values = [5u32, 8u32, 13u32, 21u32];
    let mut index = 0u32;
    while index < 4u32 {
        if values[index] > 10u32 {
            println!("Large: {}", values[index]);
        }
        index += 1u32;
    }
}
`},
"Generic call chain":{
"Cargo.toml":'[package]\nname = "generic-calls"\nversion = "0.1.0"\nedition = "2021"\n',
"src/main.rs":`fn inner<T: Display>(v: T) {
    println!("Inner {}", v);
}

fn middle<T: Display>(v: T) {
    inner(v);
}

fn outer<T: Display>(v: T) {
    middle(v);
}

fn main() {
    outer("pipeline");
    outer(123u32);
}
`},
"Boolean & arithmetic":{
"Cargo.toml":'[package]\nname = "boolean-math"\nversion = "0.1.0"\nedition = "2021"\n',
"src/main.rs":`fn compute(x: u32, y: u32) -> u32 {
    if x > y && y > 0u32 {
        return x * y + 2u32;
    }
    0u32
}

fn main() {
    println!("Result {}", compute(7u32, 4u32));
}
`},
"Compiler diagnostic":{
"Cargo.toml":'[package]\nname = "diagnostics"\nversion = "0.1.0"\nedition = "2021"\n',
"src/main.rs":`fn print_number(value: u32) {
    println!("{}", value);
}

fn main() {
    print_number("this is not a number");
}
`},
"Struct geometry":{
"Cargo.toml":'[package]\nname = "struct-geometry"\nversion = "0.1.0"\nedition = "2021"\n',
"src/main.rs":`struct Point {
    x: u32,
    y: u32,
}

fn area(size: Point) -> u32 {
    size.x * size.y
}

fn main() {
    let rectangle = Point {
        x: 7u32,
        y: 9u32,
    };
    println!("Area {}", area(rectangle));
}
`},
"Integer range iteration":{
"Cargo.toml":'[package]\nname = "range-iteration"\nversion = "0.1.0"\nedition = "2021"\n',
"src/main.rs":`fn main() {
    let mut sum = 0u32;
    for x in 1u32..=10u32 {
        sum += x;
    }
    println!("Sum {}", sum);
}
`},
"Nested ranges":{
"Cargo.toml":'[package]\nname = "nested-ranges"\nversion = "0.1.0"\nedition = "2021"\n',
"src/main.rs":`fn main() {
    for i in 1u32..3u32 {
        for j in 1u32..4u32 {
            println!("{} x {} = {}", i, j, i * j);
        }
    }
}
`},
"Pattern matching":{
"Cargo.toml":'[package]\nname = "pattern-matching"\nversion = "0.1.0"\nedition = "2021"\n',
"src/main.rs":`fn label(value: u32) -> u32 {
    match value {
        0u32 => 100u32,
        1u32 => 200u32,
        _ => 999u32,
    }
}

fn main() {
    for n in 0u32..4u32 {
        println!("{} => {}", n, label(n));
    }
}
`}
};
