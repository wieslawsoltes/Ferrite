import {sampleProjects} from '../../samples.js';
const manifest=name=>`[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\n`;
/** Each sample declares its backend and expected behavior; native-only syntax is never faked. */
export class SampleCatalog {
  static projects = [
    {name:'Geometry lab · traits & modules',expected:'rectangle area = 42\ntriangle area = 20\n',files:{
      'Cargo.toml':manifest('geometry-lab'),
      'src/main.rs':`mod geometry;
use geometry::Rect;
use geometry::Area;

fn report<T: Area>(name: &str, shape: &T) {
    println!("{} area = {}", name, shape.area());
}

fn main() {
    let rectangle = Rect { width: 7, height: 6 };
    report("rectangle", &rectangle);
    let triangle = geometry::Triangle { base: 8, height: 5 };
    report("triangle", &triangle);
}
`,
      'src/geometry.rs':`pub trait Area {
    fn area(&self) -> i32;
}

pub struct Rect {
    pub width: i32,
    pub height: i32,
}

impl Area for Rect {
    fn area(&self) -> i32 { self.width * self.height }
}

pub struct Triangle {
    pub base: i32,
    pub height: i32,
}

impl Area for Triangle {
    fn area(&self) -> i32 { self.base * self.height / 2 }
}

#[test]
fn rectangle_area() {
    let r = Rect { width: 7, height: 6 };
    assert_eq!(r.area(), 42);
}
`}},
    {name:'Type aliases · where clauses & structural inference',expected:'first = 7\npayload = 9\n',files:{
      'Cargo.toml':manifest('type-aliases'),
      'src/main.rs':`mod types;
use types::Pair;
use types::Outcome;
use std::fmt::Display;

fn first<T>(pair: Pair<T>) -> T where T: Copy { pair.0 }
fn report<T>(value: T) where T: Display + Copy { println!("first = {}", value); }

fn main() {
    let pair: Pair<u32> = (7, 8);
    report(first(pair));
    let outcome = Outcome::Ok(9);
    let Outcome::Ok(value) = outcome else { return; };
    println!("payload = {}", value);
}
`,
      'src/types.rs':`pub type Pair<T> = (T, T);
pub type Outcome = Result<u32, i32>;
`}},
    {name:'Pattern matrix · destructuring & coverage',expected:'left 7\nright 11\nmiddle 5\n',files:{
      'Cargo.toml':manifest('pattern-matrix'),
      'src/main.rs':`enum Event { Left(i32), Right(i32), Idle }
struct Point { x: i32, y: i32 }

fn handle(event: Event) -> i32 {
    let (Event::Left(value) | Event::Right(value)) = event else { return 0; };
    value
}

fn main() {
    println!("left {}", handle(Event::Left(7)));
    println!("right {}", handle(Event::Right(11)));
    let point = Point { x: 5, y: 20 };
    match point {
        Point { x: 0..=3, .. } => println!("small"),
        Point { x, y: 10..=30 } => println!("middle {}", x),
        Point { .. } => println!("other"),
    }
}
`}},
    {name:'Let-else · queue filtering',expected:'accepted 4\naccepted 8\n',files:{'Cargo.toml':manifest('let-else'),
      'src/main.rs':`fn main() {
    let entries = [Some(4), None, Some(8)];
    for entry in entries {
        let Some(value) = entry else { continue; };
        println!("accepted {}", value);
    }
}
`}},
    {name:'Closures · capture modes & call traits',expected:'scaled 42\nstate 2 3\nowned payload\n',files:{'Cargo.toml':manifest('closures'),'src/main.rs':`fn apply<F: Fn(i32) -> i32>(operation: F, value: i32) -> i32 {
    operation(value)
}

fn main() {
    let scale = 6;
    let multiply = |value| value * scale;
    println!("scaled {}", apply(multiply, 7));

    let mut count = 1;
    let mut increment = || { count += 1; count };
    println!("state {} {}", increment(), increment());

    let payload = String::from("payload");
    let consume = move || payload;
    println!("owned {}", consume());
}
`}},
    {name:'Conditional build · Cargo features & cfg',expected:'baseline false\n',files:{
      'Cargo.toml':manifest('conditional-build')+'\n[features]\ndefault=[]\nfast=[]\n',
      'src/main.rs':`// Toggle "fast" in the Cargo tool window, then Run.
#[cfg(feature = "fast")]
fn mode() -> &str { "accelerated" }

#[cfg(not(feature = "fast"))]
fn mode() -> &str { "baseline" }

#[cfg(false)]
mod unavailable_on_this_target;

fn main() {
    println!("{} {}", mode(), cfg!(feature = "fast"));
}
`}},
    {name:'Pattern control flow · if let / while let',expected:'taking 8\nskipping five\ntaking 3\nqueue drained\n',files:{'Cargo.toml':manifest('pattern-flow'),'src/main.rs':`fn main() {
    let mut queue = vec![3, 5, 8];
    while let Some(value) = queue.pop() {
        if value == 5 {
            println!("skipping five");
            continue;
        }
        println!("taking {}", value);
    }
    if let Some(last) = queue.pop() {
        println!("unexpected {}", last);
    } else {
        println!("queue drained");
    }
}
`}},
    {name:'Result pipeline · early-return propagation',expected:'result 85\nerror negative input\n',files:{'Cargo.toml':manifest('result-pipeline'),'src/main.rs':`fn validate(value: i32) -> Result<i32, &str> {
    if value < 0 { return Err("negative input"); }
    Ok(value)
}

fn transform(value: i32) -> Result<i32, &str> {
    let checked = validate(value)?;
    Ok(checked * 2 + 1)
}

fn main() {
    for value in [42, -1] {
        match transform(value) {
            Ok(result) => println!("result {}", result),
            Err(message) => println!("error {}", message),
        }
    }
}
`}},
    {name:'Local Cargo workspace · path dependency',expected:'from workspace: 42\n',files:{
      'Cargo.toml':'[workspace]\nmembers = ["apps/demo", "crates/math"]\n',
      'apps/demo/Cargo.toml':manifest('demo')+'\n[dependencies]\nmath = { path = "../../crates/math" }\n',
      'apps/demo/src/main.rs':'fn main() { println!("from workspace: {}", math::multiply(6, 7)); }\n',
      'crates/math/Cargo.toml':manifest('math'),'crates/math/src/lib.rs':'pub fn multiply(a: i32, b: i32) -> i32 { a * b }\n#[test]\nfn multiply_test() { assert_eq!(multiply(6, 7), 42); }\n'}},
    {name:'Unit tests · ignored & expected panic',expected:'run Test to execute the harness\n',files:{'Cargo.toml':manifest('unit-tests'),'src/main.rs':`fn square(value: i32) -> i32 { value * value }
fn main() { println!("run Test to execute the harness"); }

#[test]
fn arithmetic() { assert_eq!(square(7), 49); }

#[test]
fn boolean_logic() { assert!(true && !false); }

#[test]
#[ignore]
fn unfinished_test() { panic!("not executed"); }

#[test]
#[should_panic]
fn expected_panic() { panic!("intentional"); }
`}},
    {name:'Integer semantics · u128 & casts',expected:'340282366920938463463374607431768211455\nwrapped = 1\nsigned division = -3\n',files:{'Cargo.toml':manifest('integer-semantics'),'src/main.rs':`fn main() {
    let maximum = 340282366920938463463374607431768211455u128;
    println!("{}", maximum);
    println!("wrapped = {}", 257u32 as u8);
    println!("signed division = {}", -7i32 / 2i32);
}
`}},
    {name:'Ownership diagnostic · use after move',error:'E0382',files:{'Cargo.toml':manifest('ownership-diagnostic'),'src/main.rs':`fn main() {
    let original = String::from("owned value");
    let moved = original;
    println!("{}", original); // error: use after move
    println!("{}", moved);
}
`}},
    {name:'Native Rust · async, closures & macros',native:true,files:{'Cargo.toml':manifest('native-rust'),'src/main.rs':`// This sample intentionally requires the installed native Cargo toolchain.
macro_rules! greet {
    ($name:expr) => { format!("Hello, {}!", $name) };
}

async fn future_value() -> u32 { 42 }

fn main() {
    let squares: Vec<_> = (1..=5).map(|value| value * value).collect();
    println!("{} {:?}", greet!("native Rust"), squares);
    let _future = future_value();
}
`}},
    {name:'Nominal values · tuple/unit structs & assignments',expected:'port=443 swap=2/1 event=9\n',files:{
      'Cargo.toml':manifest('nominal-values'),
      'src/main.rs':`#[derive(Clone, Copy)]
struct Port(u16);
struct Ready;
struct Pair<T>(T, T);
enum Event { Value(i32) }

const fn secure_port() -> Port { Port(443) }
const HTTPS: Port = secure_port();

fn main() {
    let Ready = Ready;
    let Port(port) = HTTPS;
    let mut left = 1;
    let mut right = 2;
    Pair(left, right) = Pair(right, left);
    let mut event = 0;
    Event::Value(event) = Event::Value(9);
    println!("port={} swap={}/{} event={}", port, left, right, event);
}
`}},
    ...Object.entries(sampleProjects).map(([name,files])=>({name,files,error:name==='Compiler diagnostic'?'E0308':null}))
  ];
}
