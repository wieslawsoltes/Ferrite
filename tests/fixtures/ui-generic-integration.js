// Shared with installed-rustc differential validation: do not use the UI ABI here.
export const uiGenericCases = [
  ['UI integration: inferred private closure crosses a generic module boundary', `
mod helper { pub fn apply<T, F: Fn() -> T>(f: F) -> T { f() } }
mod data { pub fn value() -> i64 { crate::helper::apply(|| 42i64) } }
fn main() { println!("{}", data::value()); }`, '42\n'],
  ['UI integration: inferred private nominal crosses a generic module boundary', `
mod helper { pub fn identity<T>(v: T) -> T { v } }
mod data { struct Secret(i64); pub fn value() -> i64 { crate::helper::identity(Secret(42)).0 } }
fn main() { println!("{}", data::value()); }`, '42\n'],
  ['UI integration: generic inherent methods infer private closure result types', `
struct Factory<T>(T);
impl<T: Copy> Factory<T> { fn make<R, F: Fn(T) -> R>(&self, f: F) -> R { f(self.0) } }
mod data { pub fn value() -> i64 { crate::Factory(40i64).make(|n: i64| n + 2) } }
fn main() { println!("{}", data::value()); }`, '42\n'],
  ['UI integration: closure bounds resolve Self before inferring their result', `
struct Factory<T>(T);
impl<T: Copy> Factory<T> { fn map<R, F: Fn(Self) -> R>(self, f: F) -> R { f(self) } }
fn main() { println!("{}", Factory(40i64).map(|v: Factory<i64>| v.0 + 2)); }`, '42\n'],
  ['UI integration: chained closure obligations converge on output types', `
fn pipe<A, B, F: Fn() -> A, G: Fn(A) -> B>(f: F, g: G) -> B { g(f()) }
fn main() { println!("{}", pipe(|| 40i32, |n: i32| (n + 2) as i64)); }`, '42\n'],
  ['UI integration: alias owner preserves definition-site Self in callable bounds', `
mod helper {
  pub struct Factory<T>(pub T);
  pub type Alias<T> = Factory<T>;
  impl<T: Copy> Factory<T> {
    pub fn new(value: T) -> Self { Self(value) }
    pub fn map<R, F: Fn(Self) -> R>(self, f: F) -> R { f(self) }
  }
}
fn main() { println!("{}", helper::Alias::<i64>::new(40).map(|v: helper::Factory<i64>| v.0 + 2)); }`, '42\n'],
];
export const uiGenericCompileFailCases = [
  ['UI integration: an explicit private type annotation still rejects',
    'mod data { struct Secret(i64); } fn leak(v: data::Secret) {} fn main() {}', 'E0603'],
  ['UI integration: an explicit private type in an inherent method still rejects',
    'mod data { struct Secret(i64); } struct Factory<T>(T); impl<T> Factory<T> { fn leak(v: data::Secret) {} } fn main() {}', 'E0603'],
  ['UI integration: output inference cannot weaken a closure input obligation',
    'struct Factory<T>(T); impl<T> Factory<T> { fn map<R,F:Fn(T)->R>(self,f:F)->R{f(self.0)} } fn main(){let _=Factory(1i64).map(|v:bool|v);}', 'E0308'],
  ['UI integration: inferred result still respects the contextual type',
    'fn make<T,F:Fn()->T>(f:F)->T{f()} fn main(){let _:bool=make(||1i64);}', 'E0308'],
];
