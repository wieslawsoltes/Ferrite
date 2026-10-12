struct Packet {
    name: String,
    payload: String,
    sequence: u32,
}

fn main() {
    let packet = Packet {
        name: String::from("header"),
        payload: String::from("body"),
        sequence: 42,
    };
    let Packet {
        name,
        ..
    } = packet;
    match packet {
        Packet {
            payload,
            sequence: 42,
            ..
        } if payload.len() > 0 => {
            println!("{} {} {}", name, payload, packet.sequence);
        }
        _ => {}
    }
}
