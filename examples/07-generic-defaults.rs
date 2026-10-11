trait Combine<Rhs = Self> {
    fn combine(self, other: Rhs) -> i32;
}

struct Value;

impl Combine for Value {
    fn combine(self, other: Self) -> i32 {
        7
    }
}

fn apply<T: Combine>(a: T, b: T) -> i32 {
    a.combine(b)
}

fn main() {
    println!("{}", apply(Value, Value));
}
