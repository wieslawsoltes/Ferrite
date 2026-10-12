struct Packet {
    name: String,
    payload: String,
    sequence: u32,
}

fn bump(packet: &mut Packet) -> &mut u32 {
    let Packet {
        ref mut sequence,
        ..
    } = *packet;
    *sequence += 1;
    sequence
}

fn main() {
    let mut packet = Packet {
        name: String::from("header"),
        payload: String::from("body"),
        sequence: 41,
    };
    {
        let Packet {
            ref name,
            ref mut payload,
            ..
        } = packet;
        payload.push_str("!");
        println!("{} {}", *name, *payload);
    }
    println!("{}", *bump(&mut packet));
    let Packet {
        name,
        ref payload,
        ..
    } = packet;
    println!("{} {}", name, *payload);
}
