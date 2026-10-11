// Shared source is executed by all browser backends and the native rustc oracle.
export const associatedBindingCases = [
  [
    "associated binding equality on generic parameter",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}fn f<T:A<Item=i32>>(x:T::Item)->i32{x}fn main(){println!(\"{}\",f::<S>(42));}",
    "42\n"
  ],
  [
    "associated binding equality on where predicate",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}fn f<T>(x:T::Item)->i32 where T:A<Item=i32>{x}fn main(){println!(\"{}\",f::<S>(42));}",
    "42\n"
  ],
  [
    "associated binding qualified projection uses equality",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}fn f<T:A<Item=i32>>(x:<T as A>::Item)->i32{x}fn main(){println!(\"{}\",f::<S>(42));}",
    "42\n"
  ],
  [
    "associated binding generic output inference",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}fn f<T:A<Item=U>,U>(t:T,x:T::Item)->U{x}fn main(){println!(\"{}\",f(S,42));}",
    "42\n"
  ],
  [
    "associated binding later owner preserves output inference",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}fn f<T:A<Item=U>,U>(x:T::Item,t:T)->U{x}fn main(){println!(\"{}\",f(42,S));}",
    "42\n"
  ],
  [
    "associated binding binder matching item name only substitutes RHS",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}fn f<Item,T:A<Item=Item>>(x:T::Item,t:T)->Item{x}fn main(){println!(\"{}\",f(42,S));}",
    "42\n"
  ],
  [
    "associated binding literal contextual type",
    "trait A{type Item;}struct S;impl A for S{type Item=u8;}fn f<T:A<Item=u8>>(x:T::Item)->u8{x}fn main(){println!(\"{}\",f::<S>(42));}",
    "42\n"
  ],
  [
    "associated binding array output",
    "trait A{type Item;}struct S;impl A for S{type Item=[u8;2];}fn f<T:A<Item=[u8;2]>>(x:T::Item)->u8{x[0]+x[1]}fn main(){println!(\"{}\",f::<S>([20,22]));}",
    "42\n"
  ],
  [
    "associated binding tuple output",
    "trait A{type Item;}struct S;impl A for S{type Item=(i32,bool);}fn f<T:A<Item=(i32,bool)>>(x:T::Item)->i32{if x.1{x.0}else{0}}fn main(){println!(\"{}\",f::<S>((42,true)));}",
    "42\n"
  ],
  [
    "associated binding function pointer output",
    "trait A{type Item;}struct S;impl A for S{type Item=fn(i32)->i32;}fn f<T:A<Item=fn(i32)->i32>>(x:T::Item)->i32{x(21)}fn twice(x:i32)->i32{x*2}fn main(){println!(\"{}\",f::<S>(twice));}",
    "42\n"
  ],
  [
    "associated binding reference to relaxed Sized output",
    "trait A{type Item:?Sized;}struct S;impl A for S{type Item=str;}fn f<T:A<Item=str>>(x:&T::Item)->&str{x}fn main(){println!(\"{}\",f::<S>(\"42\"));}",
    "42\n"
  ],
  [
    "associated binding parameterized trait keeps input distinct",
    "trait A<X>{type Item;}struct S;impl A<bool> for S{type Item=i32;}impl A<i32> for S{type Item=bool;}fn f<T:A<bool,Item=i32>>(x:T::Item)->i32{x}fn main(){println!(\"{}\",f::<S>(42));}",
    "42\n"
  ],
  [
    "associated binding multiple associated items",
    "trait A{type Item;type Other;}struct S;impl A for S{type Item=i32;type Other=bool;}fn f<T:A<Item=i32,Other=bool>>(x:T::Item,y:T::Other)->i32{if y{x}else{0}}fn main(){println!(\"{}\",f::<S>(42,true));}",
    "42\n"
  ],
  [
    "associated binding binding order does not change selection",
    "trait A{type Item;type Other;}struct S;impl A for S{type Item=i32;type Other=bool;}fn f<T:A<Other=bool,Item=i32>>(x:T::Item,y:T::Other)->i32{if y{x}else{0}}fn main(){println!(\"{}\",f::<S>(42,true));}",
    "42\n"
  ],
  [
    "associated binding trailing comma",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}fn f<T:A<Item=i32,>>(x:T::Item)->i32{x}fn main(){println!(\"{}\",f::<S>(42));}",
    "42\n"
  ],
  [
    "associated binding canonical aliases on RHS",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}type V=i32;fn f<T:A<Item=V>>(x:T::Item)->i32{x}fn main(){println!(\"{}\",f::<S>(42));}",
    "42\n"
  ],
  [
    "associated binding renamed trait import",
    "mod api{pub trait A{type Item;}}use api::A as Bound;struct S;impl Bound for S{type Item=i32;}fn f<T:Bound<Item=i32>>(x:T::Item)->i32{x}fn main(){println!(\"{}\",f::<S>(42));}",
    "42\n"
  ],
  [
    "associated binding inherited member binding",
    "trait A{type Item;}trait B:A{}struct S;impl A for S{type Item=i32;}impl B for S{}fn f<T:B<Item=i32>>(x:T::Item)->i32{x}fn main(){println!(\"{}\",f::<S>(42));}",
    "42\n"
  ],
  [
    "associated binding supertrait declaration equality",
    "trait A{type Item;}trait B:A<Item=i32>{fn f(x:Self::Item)->i32{x}}struct S;impl A for S{type Item=i32;}impl B for S{}fn main(){println!(\"{}\",S::f(42));}",
    "42\n"
  ],
  [
    "associated binding supertrait generic substitution",
    "trait A{type Item;}trait B<X>:A<Item=X>{fn f(x:Self::Item)->X{x}}struct S;impl A for S{type Item=i32;}impl B<i32> for S{}fn main(){println!(\"{}\",S::f(42));}",
    "42\n"
  ],
  [
    "associated binding diamond inherited member deduplication",
    "trait A{type Item;}trait B:A{}trait C:A{}trait D:B+C{}struct S;impl A for S{type Item=i32;}impl B for S{}impl C for S{}impl D for S{}fn f<T:D<Item=i32>>(x:T::Item)->i32{x}fn main(){println!(\"{}\",f::<S>(42));}",
    "42\n"
  ],
  [
    "associated binding where Self supertrait equality",
    "trait A{type Item;}trait B where Self:A<Item=i32>{fn f(x:Self::Item)->i32{x}}struct S;impl A for S{type Item=i32;}impl B for S{}fn main(){println!(\"{}\",S::f(42));}",
    "42\n"
  ],
  [
    "associated binding blanket implementation applicability",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}trait B{fn f()->i32;}impl<T:A<Item=i32>>B for T{fn f()->i32{42}}fn main(){println!(\"{}\",S::f());}",
    "42\n"
  ],
  [
    "associated binding inherent implementation applicability",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}struct H<T>(T);impl<T:A<Item=i32>>H<T>{fn f()->i32{42}}fn main(){println!(\"{}\",H::<S>::f());}",
    "42\n"
  ],
  [
    "associated binding forwarded associated definition",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}trait B{type Out;}struct H<T>(T);impl<T:A<Item=i32>>B for H<T>{type Out=T::Item;}fn main(){let x:<H<S> as B>::Out=42;println!(\"{}\",x);}",
    "42\n"
  ],
  [
    "associated binding projected trait implementation bound",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}trait B{type Out:A<Item=i32>;}struct H;impl B for H{type Out=S;}fn main(){let x:<<H as B>::Out as A>::Item=42;println!(\"{}\",x);}",
    "42\n"
  ],
  [
    "associated binding nested projection in RHS",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}trait B{type Out;}struct V;impl B for V{type Out=i32;}fn f<T:A<Item=<V as B>::Out>>(x:T::Item)->i32{x}fn main(){println!(\"{}\",f::<S>(42));}",
    "42\n"
  ],
  [
    "associated binding equation propagates through second generic",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}trait B{type Out;}struct V;impl B for V{type Out=i32;}fn f<T:A<Item=U::Out>,U:B<Out=i32>>(x:T::Item)->i32{x}fn main(){println!(\"{}\",f::<S,V>(42));}",
    "42\n"
  ],
  [
    "associated binding stored record layout",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}struct H<T:A<Item=i32>>{t:T,x:T::Item}fn main(){let h=H{t:S,x:42};println!(\"{}\",h.x);}",
    "42\n"
  ],
  [
    "associated binding stored enum layout",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}enum E<T:A<Item=i32>>{V(T,T::Item)}fn main(){let E::V(_,x)=E::V(S,42);println!(\"{}\",x);}",
    "42\n"
  ],
  [
    "associated binding generic alias preserves selected output",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}type Out<T:A<Item=i32>>=T::Item;fn main(){let x:Out<S>=42;println!(\"{}\",x);}",
    "42\n"
  ],
  [
    "associated binding aggregate constants keep layouts concrete",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}struct H<T:A<Item=i32>>{t:T,x:T::Item}const C:H<S>=H::<S>{t:S,x:42};fn main(){println!(\"{}\",C.x);}",
    "42\n"
  ],
  [
    "associated binding trait method contract",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}trait B{fn f<T:A<Item=i32>>(t:T,x:T::Item)->i32;}impl B for S{fn f<U:A<Item=i32>>(t:U,x:U::Item)->i32{x}}fn main(){println!(\"{}\",S::f(S,42));}",
    "42\n"
  ],
  [
    "associated binding default method freshens colliding type binder",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}trait B{fn f<Item,T:A<Item=Item>>(t:T,x:T::Item)->Item{x}}struct H<Item>(Item);impl<Item>B for H<Item>{}fn main(){println!(\"{}\",H::<bool>::f(S,42));}",
    "42\n"
  ],
  [
    "associated binding constraint permits declared concrete inherent method",
    "trait A{type Item;}struct S;struct V;impl V{fn n(self)->i32{42}}impl A for S{type Item=V;}fn f<T:A<Item=V>>(x:T::Item)->i32{x.n()}fn main(){println!(\"{}\",f::<S>(V));}",
    "42\n"
  ],
  [
    "associated binding declaration scopes keep equal spelling distinct",
    "trait A{type Item;}struct S;struct V;impl A for S{type Item=i32;}impl A for V{type Item=bool;}fn f<T:A<Item=i32>>(x:T::Item)->i32{x}fn g<T:A<Item=bool>>(x:T::Item)->i32{if x{42}else{0}}fn main(){println!(\"{} {}\",f::<S>(42),g::<V>(true));}",
    "42 42\n"
  ],
  [
    "associated binding duplicate equivalent predicates",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}fn f<T:A<Item=i32>>(x:T::Item)->i32 where T:A<Item=i32>{x}fn main(){println!(\"{}\",f::<S>(42));}",
    "42\n"
  ],
  [
    "associated binding unselected value cache cannot change generic equation",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}fn f<T:A<Item=i32>>(x:T::Item)->i32{x}fn main(){let y:<S as A>::Item=1;println!(\"{}\",f::<S>(42));}",
    "42\n"
  ],
  [
    "associated binding argument evaluation order",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}fn n()->i32{print!(\"value \");42}fn s()->S{print!(\"owner \");S}fn f<T:A<Item=i32>>(x:T::Item,t:T)->i32{x}fn main(){println!(\"{}\",f(n(),s()));}",
    "value owner 42\n"
  ],
  [
    "associated binding function item signature",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}fn f<T:A<Item=i32>>(t:T,x:T::Item)->i32{x}fn main(){let g:fn(S,i32)->i32=f;println!(\"{}\",g(S,42));}",
    "42\n"
  ],
  [
    "associated binding equality on unused generic declaration",
    "trait A{type Item;}fn f<T:A<Item=i32>>(x:T::Item)->i32{x}fn main(){println!(\"42\");}",
    "42\n"
  ],
  [
    "associated binding raw identifier binding",
    "trait A{type r#type;}struct S;impl A for S{type r#type=i32;}fn f<T:A<r#type=i32>>(x:T::r#type)->i32{x}fn main(){println!(\"{}\",f::<S>(42));}",
    "42\n"
  ],
  [
    "associated binding permits redundant duplicate binding",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}fn f<T:A<Item=i32,Item=i32>>(x:T){}fn main(){}",
    ""
  ],
  [
    "associated binding permits unused conflicting predicates",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}fn f<T:A<Item=i32>>(x:T)where T:A<Item=bool>{}fn main(){}",
    ""
  ],
  [
    "associated binding native alias-mismatched-bound",
    "trait A{type Item;}struct S;impl A for S{type Item=bool;}type V<T:A<Item=i32>>=T::Item;fn main(){let x:V<S>=true;println!(\"{}\",x);}",
    "true\n"
  ],
  [
    "associated binding native same-item-through-child",
    "trait A{type Item;}trait B:A{type Item;}fn f<T:B<Item=i32>>(x:T){}fn main(){}",
    ""
  ],
  [
    "associated binding native associated-bound-nested-refinement",
    "trait A{type Item:B<Out=i32>;}trait B{type Out;}struct S;struct V;impl A for S{type Item=V;}impl B for V{type Out=i32;}fn f<T:A>(x:<<T as A>::Item as B>::Out)->i32{x}fn main(){println!(\"{}\",f::<S>(42));}",
    "42\n"
  ],
  [
    "associated binding native alias-forward-bound",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}type V<T:A<Item=i32>>=T::Item;fn f<T:A>(x:T::Item)->V<T>{x}fn main(){println!(\"{}\",f::<S>(42));}",
    "42\n"
  ],
  [
    "associated binding native where-projection-equality",
    "trait A{type Item;}trait B{type Out;}struct S;struct V;impl A for S{type Item=V;}impl B for V{type Out=i32;}fn f<T:A>(x:<<T as A>::Item as B>::Out)->i32 where T::Item:B<Out=i32>{x}fn main(){println!(\"{}\",f::<S>(42));}",
    "42\n"
  ],
  [
    "associated binding native direct-equality-to-self",
    "trait A{type Item;}fn f<T:A<Item=T>>(x:T::Item)->T{x}fn main(){}",
    ""
  ],
  [
    "associated binding native duplicate-different-unused",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}fn f<T:A<Item=i32,Item=bool>>(x:T){}fn main(){}",
    ""
  ],
  [
    "associated binding native duplicate-identical-used",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}fn f<T:A<Item=i32,Item=i32>>(x:T::Item)->i32{x}fn main(){println!(\"{}\",f::<S>(42));}",
    "42\n"
  ],
  [
    "associated binding native method-omits-equality-constant",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}trait B{fn f<T:A<Item=i32>>(t:T,x:T::Item)->i32;}impl B for S{fn f<U:A>(t:U,x:U::Item)->i32{42}}fn main(){println!(\"{}\",S::f(S,42));}",
    "42\n"
  ],
  [
    "associated binding native method-omits-equality-projected-return",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}trait B{fn f<T:A<Item=i32>>(t:T,x:T::Item)->i32;}impl B for S{fn f<U:A>(t:U,x:U::Item)->U::Item{x}}fn main(){println!(\"{}\",S::f(S,42));}",
    "42\n"
  ],
  [
    "associated binding native struct-only-projected-use",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}struct H<T:A<Item=i32>>{x:T::Item}fn main(){let h=H::<S>{x:42};println!(\"{}\",h.x);}",
    "42\n"
  ],
  [
    "associated binding native alias-projected-use",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}type H<T:A<Item=i32>>=T::Item;fn main(){let h:H<S>=42;println!(\"{}\",h);}",
    "42\n"
  ],
  [
    "associated binding native child-own-binding-used",
    "trait A{type Item;}trait B:A{type Item;}struct S;impl A for S{type Item=bool;}impl B for S{type Item=i32;}fn f<T:B<Item=i32>>(x:<T as B>::Item)->i32{x}fn main(){println!(\"{}\",f::<S>(42));}",
    "42\n"
  ],
  [
    "associated binding native alias-inherited-equality-through-supertrait",
    "trait A{type Item;}trait B:A<Item=i32>{}struct S;impl A for S{type Item=bool;}type H<T:B>=T::Item;fn main(){let h:H<S>=true;println!(\"{}\",h);}",
    "true\n"
  ],
  [
    "associated binding native noninjective-equality-no-parameter-in-impl",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}trait B{}impl<T:A<Item=U>,U>B for T{}fn main(){}",
    ""
  ],
  [
    "associated binding infers output-only function parameter",
    "trait A{type Item;}struct S;impl A for S{type Item=u8;}fn f<T:A<Item=U>,U>(t:T)->Option<U>{None}fn main(){println!(\"{}\",f(S).is_none());}",
    "true\n"
  ],
  [
    "associated binding infers output literal type from prior owner",
    "trait A{type Item;}struct S;impl A for S{type Item=u8;}fn f<T:A<Item=U>,U>(t:T,x:U)->U{x}fn main(){println!(\"{}\",f(S,42));}",
    "42\n"
  ],
  [
    "associated binding defers output literal type until later owner",
    "trait A{type Item;}struct S;impl A for S{type Item=u8;}fn f<T:A<Item=U>,U>(x:U,t:T)->U{x}fn main(){println!(\"{}\",f(42,S));}",
    "42\n"
  ],
  [
    "associated binding infers function item output with equality",
    "trait A{type Item;}struct S;impl A for S{type Item=u8;}fn f<T:A<Item=U>,U>(t:T,x:U)->U{x}fn main(){let p:fn(S,u8)->u8=f;println!(\"{}\",p(S,42));}",
    "42\n"
  ],
  [
    "associated binding blanket output parameter and method contract",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}trait B{type Out;fn f(x:Self::Out)->Self::Out;}impl<T:A<Item=U>,U>B for T{type Out=U;fn f(x:U)->U{x}}fn main(){println!(\"{}\",S::f(42));}",
    "42\n"
  ],
  [
    "associated binding blanket structural output determines parameter",
    "trait A{type Item;}struct S;impl A for S{type Item=(i32,bool);}trait B{type Out;}impl<T:A<Item=(U,bool)>,U>B for T{type Out=U;}fn main(){let x:<S as B>::Out=42;println!(\"{}\",x);}",
    "42\n"
  ],
  [
    "associated binding inherent output-only parameter",
    "trait A{type Item;}struct S;impl A for S{type Item=u8;}struct H<T>(T);impl<T:A<Item=U>,U>H<T>{fn f(x:U)->U{x}}fn main(){println!(\"{}\",H::<S>::f(42));}",
    "42\n"
  ],
  [
    "associated binding forward binding chain determines impl parameters",
    "trait A{type Item;}struct S;struct V;impl A for S{type Item=V;}trait B{type Out;}impl B for V{type Out=i32;}trait C{type Output;}impl<T:A<Item=U>,U:B<Out=W>,W>C for T{type Output=W;}fn main(){let x:<S as C>::Output=42;println!(\"{}\",x);}",
    "42\n"
  ]
];

export const associatedBindingCompileFailCases = [
  [
    "associated binding rejects mismatched concrete output",
    "trait A{type Item;}struct S;impl A for S{type Item=bool;}fn f<T:A<Item=i32>>(x:T){}fn main(){f(S);}",
    "E0277"
  ],
  [
    "associated binding rejects missing base implementation",
    "trait A{type Item;}struct S;fn f<T:A<Item=i32>>(x:T){}fn main(){f(S);}",
    "E0277"
  ],
  [
    "associated binding rejects wrong trait type argument",
    "trait A<X>{type Item;}struct S;impl A<bool> for S{type Item=i32;}fn f<T:A<i32,Item=i32>>(x:T){}fn main(){f(S);}",
    "E0277"
  ],
  [
    "associated binding rejects extra positional argument",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}fn f<T:A<bool,Item=i32>>(x:T){}fn main(){}",
    "E0107"
  ],
  [
    "associated binding rejects unknown member in unused declaration",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}fn f<T:A<Unknown=i32>>(x:T){}fn main(){}",
    "E0220"
  ],
  [
    "associated binding rejects unknown RHS type",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}fn f<T:A<Item=Unknown>>(x:T){}fn main(){}",
    "E0412"
  ],
  [
    "associated binding rejects nominal argument binding",
    "struct H<T>(T);fn main(){let x:H<Item=i32>=H(1);}",
    "E0229"
  ],
  [
    "associated binding rejects function turbofish binding",
    "fn f<T>(x:T){}fn main(){f::<T=i32>(1);}",
    "E0229"
  ],
  [
    "associated binding rejects qualified trait path binding",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}fn main(){let x:<S as A<Item=i32>>::Item=1;}",
    "E0229"
  ],
  [
    "associated binding rejects implementation head binding",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}struct V;impl A<Item=i32> for V{type Item=i32;}fn main(){}",
    "E0229"
  ],
  [
    "associated binding rejects inherited ambiguous member",
    "trait A{type Item;}trait B{type Item;}trait C:A+B{}fn f<T:C<Item=i32>>(x:T){}fn main(){}",
    "E0222"
  ],
  [
    "associated binding rejects supertrait implementation wrong output",
    "trait A{type Item;}trait B:A<Item=i32>{}struct S;impl A for S{type Item=bool;}impl B for S{}fn main(){}",
    "E0277"
  ],
  [
    "associated binding rejects associated declared bound wrong output",
    "trait A{type Item;}trait B{type Out:A<Item=i32>;}struct S;impl A for S{type Item=bool;}struct H;impl B for H{type Out=S;}fn main(){}",
    "E0277"
  ],
  [
    "associated binding rejects blanket implementation constraint not met",
    "trait A{type Item;}struct S;impl A for S{type Item=bool;}trait B{fn f()->i32;}impl<T:A<Item=i32>>B for T{fn f()->i32{42}}fn main(){S::f();}",
    "E0277"
  ],
  [
    "associated binding rejects cannot infer input from known output",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}fn f<T:A<Item=i32>>(x:T::Item)->i32{x}fn main(){f(42);}",
    "E0282"
  ],
  [
    "associated binding rejects equation does not excuse expression mismatch",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}fn f<T:A<Item=i32>>(x:T::Item)->bool{x}fn main(){f::<S>(42);}",
    "E0308"
  ],
  [
    "associated binding rejects adding stricter method requirement",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}trait B{fn f<T:A>(t:T);}impl B for S{fn f<U:A<Item=i32>>(t:U){}}fn main(){}",
    "E0276"
  ],
  [
    "associated binding rejects invalid concrete predicate even unused",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}fn f()where S:A<Item=bool>{}fn main(){}",
    "E0277"
  ],
  [
    "associated binding rejects item binding not positional generic",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}fn f<T:A<i32>>(t:T){}fn main(){}",
    "E0107"
  ],
  [
    "associated binding rejects opaque output constraint mismatch",
    "trait A{type Item;}struct S;impl A for S{type Item=bool;}fn f()->impl A<Item=i32>{S}fn main(){f();}",
    "E0277"
  ],
  [
    "associated binding rejects method names are not associated types",
    "trait A{fn Item();}fn f<T:A<Item=i32>>(t:T){}fn main(){}",
    "E0220"
  ],
  [
    "associated binding rejects equality cycle",
    "trait A{type Item;}fn f<T:A<Item=U::Item>,U:A<Item=T::Item>>(x:T::Item){}fn main(){}",
    "E0391"
  ],
  [
    "associated binding rejects type argument after named binding",
    "trait A<T>{type Item;}fn f<T:A<Item=i32,bool>>(x:T){}fn main(){}",
    "E0229"
  ],
  [
    "associated binding explicit body cannot borrow omitted contract equality",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}trait B{fn f<T:A<Item=i32>>(t:T,x:T::Item)->i32;}impl B for S{fn f<U:A>(t:U,x:U::Item)->i32{x}}fn main(){println!(\"{}\",S::f(S,42));}",
    "E0308"
  ],
  [
    "associated binding native alias-no-parameter-use",
    "trait A{type Item;}type V<T:A<Item=i32>>=i32;fn main(){}",
    "E0091"
  ],
  [
    "associated binding native duplicate-different-projection-unused",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}fn f<T:A<Item=i32,Item=bool>>(x:T::Item){}fn main(){}",
    "E0284"
  ],
  [
    "associated binding native conflicting-two-bounds-projection-unused",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}fn f<T:A<Item=i32>>(x:T::Item)where T:A<Item=bool>{}fn main(){}",
    "E0284"
  ],
  [
    "associated binding native method-omits-base-bound",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}trait B{fn f<T:A<Item=i32>>(t:T,x:T::Item)->i32;}impl B for S{fn f<U>(t:U,x:U::Item)->i32{42}}fn main(){println!(\"{}\",S::f(S,42));}",
    "E0220"
  ],
  [
    "associated binding native alias-unknown-binding-member",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}type H<T:A<Missing=i32>>=T::Item;fn main(){}",
    "E0220"
  ],
  [
    "associated binding direct explicit method return preserves omission",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}trait B{fn f<T:A<Item=i32>>(t:T,x:T::Item)->i32;}impl B for S{fn f<U:A>(t:U,x:U::Item)->i32{return x;}}fn main(){println!(\"{}\",S::f(S,42));}",
    "E0308"
  ],
  [
    "associated binding does not reverse infer input parameter",
    "trait A{type Item;}struct S;impl A for S{type Item=i32;}trait B{}impl<T,U:A<Item=T>>B for T{}fn main(){}",
    "E0207"
  ],
  [
    "associated binding does not infer through projected output",
    "trait A{type Item;}trait B{type Out;}trait C{}impl<T:A<Item=U::Out>,U:B>C for T{}fn main(){}",
    "E0207"
  ],
  [
    "associated binding rejects used duplicate contradictory constraints",
    "trait A{type Item;}struct S;impl A for S{type Item=u8;}fn f<T:A<Item=u8,Item=bool>>(t:T){}fn main(){f(S);}",
    "E0277"
  ],
  [
    "associated binding forward invariant output type rejects wrong tuple",
    "trait A{type Item;}struct S;impl A for S{type Item=(i32,u8);}trait B{type Out;}impl<T:A<Item=(U,bool)>,U>B for T{type Out=U;}fn main(){let x:<S as B>::Out=42;}",
    "E0277"
  ]
];
