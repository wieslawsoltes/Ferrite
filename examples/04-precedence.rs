fn main() {
    let a = 2u32 + 3u32 * 4u32;
    let b = (2u32 + 3u32) * 4u32;
    println!("Precedence: {} versus {}", a, b);
}