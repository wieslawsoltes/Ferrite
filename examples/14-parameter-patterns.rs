fn add((left, right): &mut (i32, i32)) {
    *left += *right;
}

fn first((left, _): &mut (i32, i32)) -> &mut i32 {
    left
}

fn main() {
    let mut pair = (39, 2);
    let handle = &mut pair;

    add(handle);
    *first(handle) += 1;

    let sum = |(left, right): &(i32, i32)| *left + *right;
    println!("{} {}", pair.0, sum(&pair));
}
