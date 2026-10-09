/** Reviewed user-trait fixtures, also run unchanged by installed rustc. */
export const genericTraitCases=[
 ['generic trait target','trait Value{fn value(&self)->i32;}struct C<T>(T);impl<T:Copy>Value for C<T>{fn value(&self)->i32{42}}fn value<U:Value>(v:U)->i32{v.value()}fn main(){println!("{}",value(C(true)));}','42\n'],
 ['blanket trait implementation','trait Value{fn value(&self)->i32;}impl<T:Copy>Value for T{fn value(&self)->i32{17}}fn value<U:Value>(v:U)->i32{v.value()}fn main(){println!("{}",value(true));}','17\n'],
 ['recursive finite trait proof','trait Mark{}impl Mark for i32{}struct C<T>(T);impl<T:Mark>Mark for C<T>{}fn accept<T:Mark>(v:T)->i32{5}fn main(){println!("{}",accept(C(C(1))));}','5\n'],
 ['blanket where predicates','trait Mark{}impl Mark for i32{}trait Value{fn value(&self)->i32;}struct C<T>(T);impl<T>Value for C<T>where T:Mark{fn value(&self)->i32{29}}fn main(){println!("{}",C(1).value());}','29\n'],
 ['inherited default calls required method','trait Value{fn value(&self)->i32;fn twice(&self)->i32{self.value()+self.value()}}struct C<T>(T);impl<T:Copy>Value for C<T>{fn value(&self)->i32{3}}fn main(){let c=C(true);println!("{}",c.twice());}','6\n'],
 ['overridden trait default','trait Value{fn value(&self)->i32{3}}struct C<T>(T);impl<T>Value for C<T>{fn value(&self)->i32{8}}fn main(){println!("{}",C(1).value());}','8\n'],
 ['default resolves own trait before concrete inherent method','trait Value{fn value(&self)->i32;fn twice(&self)->i32{self.value()+self.value()}}struct C<T>(T);impl<T>Value for C<T>{fn value(&self)->i32{2}}impl<T>C<T>{fn value(&self)->i32{100}}fn main(){println!("{} {}",C(1).twice(),C(1).value());}','4 100\n'],
 ['method binder distinct from implementing binder','trait Identity{fn identity<T>(self,x:T)->T;}struct C<T>(T);impl<T>Identity for C<T>{fn identity<U>(self,x:U)->U{x}}fn main(){println!("{}",C(true).identity(42));}','42\n'],
 ['trait method inherited bounds','trait Identity{fn identity<T:Copy>(self,x:T)->T;}struct C<T>(T);impl<T>Identity for C<T>{fn identity<U>(self,x:U)->U{x}}fn main(){println!("{}",C(true).identity(42));}','42\n'],
 ['trait method explicit generic arguments','trait Identity{fn identity<U>(&self,x:U)->U;}struct C<T>(T);impl<T>Identity for C<T>{fn identity<U>(&self,x:U)->U{x}}fn main(){println!("{}",C(true).identity::<u64>(4294967296));}','4294967296\n'],
 ['trait associated function and Self','trait Create{fn create()->Self;}struct C<T>(T);impl Create for C<i32>{fn create()->Self{Self(31)}}fn main(){let c=C::create();println!("{}",c.0);}','31\n'],
 ['trait method function pointer','trait Value{fn value(&self)->i32;}struct C<T>(T);impl<T>Value for C<T>{fn value(&self)->i32{19}}fn main(){let f:fn(&C<bool>)->i32=C::<bool>::value;let c=C(true);println!("{}",f(&c));}','19\n'],
 ['trait default function pointer','trait Value{fn value(&self)->i32{21}}struct C<T>(T);impl<T>Value for C<T>{}fn main(){let f:fn(&C<bool>)->i32=C::<bool>::value;let c=C(true);println!("{}",f(&c));}','21\n'],
 ['trait default lexical namespace','mod api{fn amount()->i32{23}pub trait Value{fn value(&self)->i32{amount()}}}use api::Value;struct C<T>(T);impl<T>Value for C<T>{}fn amount()->i32{100}fn main(){println!("{}",C(1).value());}','23\n'],
 ['renamed trait import','mod api{pub trait Value{fn value(&self)->i32;}}use api::Value as Read;struct C<T>(T);impl<T>Read for C<T>{fn value(&self)->i32{24}}fn main(){println!("{}",C(1).value());}','24\n'],
 ['trait bound qualified identity','mod api{pub trait Mark{}}struct C<T>(T);impl<T:Copy>api::Mark for C<T>{}fn accept<U:api::Mark>(v:U)->i32{25}fn main(){println!("{}",accept(C(true)));}','25\n'],
 ['generic implementation on arrays','trait Value{fn value(&self)->i32;}impl<T:Copy>Value for [T;2]{fn value(&self)->i32{26}}fn main(){println!("{}",[1,2].value());}','26\n'],
 ['generic implementation on tuples','trait Value{fn value(&self)->i32;}impl<T:Copy>Value for (T,bool){fn value(&self)->i32{27}}fn main(){println!("{}",(1,true).value());}','27\n'],
 ['generic implementation on enum','trait Value{fn value(&self)->i32;}enum C<T>{Value(T)}impl<T>Value for C<T>{fn value(&self)->i32{28}}fn main(){println!("{}",C::Value(1).value());}','28\n'],
 ['generic trait condition in inherent header','trait Mark{}impl Mark for i32{}struct C<T>(T);impl<T:Mark>Mark for C<T>{}struct W<U:Mark>(U);impl<T:Mark>W<C<T>>{fn new(v:T)->Self{Self(C(v))}}fn main(){let w=W::new(29);println!("{}",w.0.0);}','29\n'],
 ['separate concrete implementations of one trait','trait Value{fn value(&self)->i32;}impl Value for i32{fn value(&self)->i32{1}}impl Value for bool{fn value(&self)->i32{2}}fn main(){println!("{} {}",1.value(),true.value());}','1 2\n'],
 ['mutation through trait method','trait Update{fn update(&mut self);}struct C<T>(T,i32);impl<T>Update for C<T>{fn update(&mut self){self.1+=1;}}fn main(){let mut c=C(true,40);c.update();c.update();println!("{}",c.1);}','42\n'],
 ['owned receiver trait','trait Consume{fn consume(self)->i32;}struct C<T>(T);impl<T>Consume for C<T>{fn consume(self)->i32{30}}fn main(){println!("{}",C(String::from("owned")).consume());}','30\n'],
 ['local marker named Copy is separate from builtin Copy','trait Copy{}impl Copy for i32{}fn accept<T:Copy>(v:T)->i32{31}fn main(){println!("{}",accept(1));}','31\n'],
 ['default generic method independent binder','trait Identity{fn identity<U>(&self,value:U)->U{value}}struct C<T>(T);impl<T>Identity for C<T>{}fn main(){println!("{}",C(true).identity(32));}','32\n'],
];
export const genericTraitCompileFailCases=[
 ['missing required trait method','trait Value{fn value(&self)->i32;}struct C<T>(T);impl<T>Value for C<T>{}fn main(){}','E0046'],
 ['extra trait method','trait Mark{}struct C<T>(T);impl<T>Mark for C<T>{fn extra(&self){}}fn main(){}','E0407'],
 ['wrong trait result','trait Value{fn value(&self)->i32;}struct C<T>(T);impl<T>Value for C<T>{fn value(&self)->bool{true}}fn main(){}','E0053'],
 ['wrong trait receiver','trait Value{fn value(&self);}struct C<T>(T);impl<T>Value for C<T>{fn value(self){}}fn main(){}','E0053'],
 ['wrong trait parameter count','trait Value{fn value(&self);}struct C<T>(T);impl<T>Value for C<T>{fn value(&self,x:i32){}}fn main(){}','E0050'],
 ['wrong trait generic arity','trait Value{fn value<U>(&self,x:U);}struct C<T>(T);impl<T>Value for C<T>{fn value(&self,x:i32){}}fn main(){}','E0049'],
 ['stricter impl method bound','trait Identity{fn identity<T>(self,x:T)->T;}struct C<T>(T);impl<T>Identity for C<T>{fn identity<U:Copy>(self,x:U)->U{x}}fn main(){}','E0276'],
 ['stricter impl where predicate','trait Identity{fn identity<U>(&self,x:U)->U;}struct C<T>(T);impl<T>Identity for C<T>{fn identity<U>(&self,x:U)->U where U:Copy{x}}fn main(){}','E0276'],
 ['overlapping blanket traits','trait Mark{}impl<T>Mark for T{}impl Mark for i32{}fn main(){}','E0119'],
 ['overlapping generic traits','trait Mark{}struct C<T>(T);impl<T>Mark for C<T>{}impl Mark for C<i32>{}fn main(){}','E0119'],
 ['unknown implemented trait','struct C<T>(T);impl<T>Unknown for C<T>{}fn main(){}','E0405'],
 ['failed recursive generic trait obligation','trait Mark{}impl Mark for i32{}struct C<T>(T);impl<T:Mark>Mark for C<T>{}fn accept<T:Mark>(v:T){}fn main(){accept(C(true));}','E0277'],
 ['cyclic traits are not proofs','trait Mark{}impl<T:Mark>Mark for T{}fn accept<T:Mark>(v:T){}fn main(){accept(1);}','E0277'],
 ['same named traits retain distinct identity','mod a{pub trait Mark{}impl Mark for i32{}}mod b{pub trait Mark{}}fn accept<T:b::Mark>(v:T){}fn main(){accept(1);}','E0277'],
 ['trait methods require imported trait','mod api{pub trait Value{fn value(&self)->i32;}pub struct C(pub i32);impl Value for C{fn value(&self)->i32{self.0}}}fn main(){println!("{}",api::C(1).value());}','E0599'],
 ['trait imports do not leak into nested modules','trait Value{fn value(&self)->i32;}struct C(i32);impl Value for C{fn value(&self)->i32{self.0}}mod nested{pub fn run()->i32{super::C(1).value()}}fn main(){}','E0599'],
 ['trait method const rejection','trait Value{fn value(&self)->i32;}struct C;impl Value for C{const fn value(&self)->i32{1}}fn main(){}','E0379'],
 ['trait declaration const rejection','trait Value{const fn value(&self)->i32;}fn main(){}','E0379'],
 ['trait impl visibility rejection','trait Value{fn value(&self)->i32;}struct C;impl Value for C{pub fn value(&self)->i32{1}}fn main(){}','E0449'],
 ['trait declaration visibility rejection','trait Value{pub fn value(&self)->i32;}fn main(){}','E0449'],
 ['duplicate trait methods','trait Value{fn value(&self);fn value(&self);}fn main(){}','E0428'],
 ['trait signature unknown type','trait Value{fn value(&self)->Missing;}fn main(){}','E0412'],
 ['trait impl cannot drop a receiver','trait Value{fn value(&self);}struct C;impl Value for C{fn value(){}}fn main(){}','E0050'],
 ['unsatisfied inherited method bound','trait Identity{fn identity<T:Copy>(self,x:T)->T;}struct C<T>(T);impl<T>Identity for C<T>{fn identity<U>(self,x:U)->U{x}}fn main(){let _=C(true).identity(String::from("owned"));}','E0277'],
 ['local marker Copy is not ownership Copy','trait Copy{}struct C{v:String}impl Copy for C{}fn take<T:Copy>(v:T){}fn main(){let c=C{v:String::from("owned")};take(c);take(c);}','E0382'],
];

genericTraitCases.push(
 ['default generic binder alpha renaming','trait Identity{fn identity<T>(&self,value:T)->T{let result:T=value;result}}struct C<T>(T);impl<T>Identity for C<T>{}fn main(){println!("{}",C(true).identity(33));}','33\n'],
 ['default binder renaming does not change strings or fields','trait Identity{fn identity<T>(&self,value:T)->T{println!("T::value");value}}struct C<T>{value:T}impl<T>Identity for C<T>{}fn main(){println!("{}",C{value:true}.identity(34));}','T::value\n34\n'],
 ['default contextual Self construction','trait Create{fn create()->Self;fn other()->Self{Self::create()}}struct C<T>(T);impl Create for C<i32>{fn create()->Self{Self(35)}}fn main(){println!("{}",C::other().0);}','35\n'],
 ['multiple traits selected by local scope','mod one{pub trait Value{fn value(&self)->i32;}}mod two{pub trait Value{fn value(&self)->i32;}}struct C;impl one::Value for C{fn value(&self)->i32{36}}impl two::Value for C{fn value(&self)->i32{37}}use one::Value;fn main(){println!("{}",C.value());}','36\n'],
 ['const expression in trait signatures','const fn size()->usize{2}trait Value{fn value(&self)->[i32;size()];}struct C;impl Value for C{fn value(&self)->[i32;size()]{[38,39]}}fn main(){println!("{}",C.value()[0]);}','38\n'],
 ['private trait does not leak into bounded parent scope','mod implementation{trait Value{fn value(&self)->i32;}pub struct C;impl Value for C{fn value(&self)->i32{39}}pub fn run()->i32{C.value()}}fn main(){println!("{}",implementation::run());}','39\n'],
 ['marker same spelling as builtin is not automatic','trait Copy{}impl Copy for bool{}fn accepted<T:Copy>(v:T)->i32{40}fn main(){println!("{}",accepted(true));}','40\n']
);
genericTraitCompileFailCases.push(
 ['ambiguous imported trait methods','mod one{pub trait Value{fn value(&self)->i32;}}mod two{pub trait Value{fn value(&self)->i32;}}struct C;impl one::Value for C{fn value(&self)->i32{1}}impl two::Value for C{fn value(&self)->i32{2}}use one::Value;use two::Value as Other;fn main(){C.value();}','E0034'],
 ['trait method unknown bound in unused declaration','trait Value{fn value<T:Missing>(&self,value:T);}fn main(){}','E0405'],
 ['trait method placeholder signature','trait Value{fn value(&self)->_;}fn main(){}','E0121'],
 ['marker Copy cannot inherit builtin proof','trait Copy{}fn accepted<T:Copy>(v:T){}fn main(){accepted(1);}','E0277'],
 ['trait parameter application arity','trait Value{}struct C<T>(T);impl<T>Value<T> for C<T>{}fn main(){}','E0107']
);
genericTraitCompileFailCases.push(
 ['associated trait calls cannot bypass scope','mod api{pub trait V{fn value()->i32;}pub struct C;impl V for C{fn value()->i32{1}}}fn main(){api::C::value();}','E0599'],
 ['associated trait function values cannot bypass scope','mod api{pub trait V{fn value()->i32;}pub struct C;impl V for C{fn value()->i32{1}}}fn main(){let f=api::C::value;f();}','E0599']
);
