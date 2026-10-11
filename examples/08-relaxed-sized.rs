trait Text {
    fn bytes(&self) -> usize;
}

impl Text for str {
    fn bytes(&self) -> usize {
        self.len()
    }
}

fn bytes<T: ?Sized + Text>(value: &T) -> usize {
    value.bytes()
}

struct Marker<T: ?Sized = str>(std::marker::PhantomData<T>);

fn main() {
    let _marker: Marker = Marker(std::marker::PhantomData);
    println!("{}", bytes::<str>("café"));
}
