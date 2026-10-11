trait Value {
    type Item;
    fn value(&self) -> Self::Item;
}

struct Byte(u8);

impl Value for Byte {
    type Item = u8;

    fn value(&self) -> u8 {
        self.0
    }
}

// T is not stored, but is determined by S's declared associated output.
struct Reader<S: Value<Item = T>, T> {
    source: S,
}

impl<S: Value<Item = T>, T> Reader<S, T> {
    fn read(&self) -> T {
        self.source.value()
    }
}

// Self retains the surrounding type arguments in the stored function pointer.
struct Callback<T> {
    value: T,
    call: fn(Self) -> T,
}

fn invoke(callback: Callback<u8>) -> u8 {
    callback.value
}

fn main() {
    let reader: Reader<Byte, u8> = Reader { source: Byte(7) };
    let callback = Callback {
        value: reader.read(),
        call: invoke,
    };
    let call = callback.call;
    println!("{}", call(callback));
}
