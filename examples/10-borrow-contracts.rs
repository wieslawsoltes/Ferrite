fn retain<T>(value: &T) -> &T {
    value
}

struct Counter {
    value: i32,
}

impl Counter {
    fn borrow(&mut self) -> &mut i32 {
        &mut self.value
    }
}

fn add(value: &mut i32, amount: i32) {
    *value += amount;
}

fn main() {
    let mut counter = Counter {
        value: 20,
    };
    let reference = counter.borrow();
    add(reference, *reference + 2);
    println!("{}", *retain(&counter.value));
}
