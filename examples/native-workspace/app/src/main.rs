use std::{
    env,
    io::{self, Write},
    thread,
};

include!(concat!(env!("OUT_DIR"), "/build_info.rs"));
const ASSET: &[u8] = include_bytes!("../assets/demo.bin");

fn main() -> io::Result<()> {
    let total = thread::scope(|scope| {
        let left = scope.spawn(|| lab_math::sum([10_i64, 20]));
        let right = scope.spawn(|| lab_math::sum([5_i64, 7]));
        left.join().expect("left worker panicked") + right.join().expect("right worker panicked")
    });
    assert_eq!(total, answer_macro::answer!());
    println!("total={total}, asset={} bytes, {GENERATED}", ASSET.len());
    println!("{}", env!("FERRITE_DEMO_CONFIG"));
    if !env::args().any(|argument| argument == "--no-input") {
        print!("Name: ");
        io::stdout().flush()?;
        let mut line = String::new();
        io::stdin().read_line(&mut line)?;
        println!("Hello, {}!", line.trim());
    }
    Ok(())
}
