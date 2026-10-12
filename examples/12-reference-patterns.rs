struct Packet {
    name: String,
    count: i32,
}

fn main() {
    let mut packet = Packet {
        name: String::from("packet"),
        count: 40,
    };
    let Packet {
        ref name,
        ref mut count,
    } = packet;
    *count += 2;
    println!("{} {}", *name, *count);

    let mut result = Some((1, 2));
    if let Some((ref mut left, ref right)) = result {
        *left += *right;
    }
    let Some((left, right)) = result else {
        return;
    };
    println!("{} {}", left, right);
}
