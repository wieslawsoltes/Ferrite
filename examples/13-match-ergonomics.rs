struct Pair<T> {
    left: T,
    right: T,
}

fn first<T>(pair: &mut Pair<T>) -> &mut T {
    let Pair {
        left,
        ..
    } = pair;
    left
}

fn main() {
    let mut pair = Pair {
        left: 40,
        right: 2,
    };
    *first(&mut pair) += 2;

    // The explicit reference prefix copies the scalar, not its reference.
    let &snapshot = &pair.left;

    // The constructor pattern borrows its payload without moving the Option.
    let value = Some((snapshot, pair.right));
    if let Some((left, right)) = &value {
        println!("{} {}", *left, *right);
    }
    println!("{}", value.is_some());
}
