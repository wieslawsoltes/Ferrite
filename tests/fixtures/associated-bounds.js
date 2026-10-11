// Exact-source regressions shared by the native Rust and browser-backend runners.
// Universal checking of uninstantiated generic bodies remains a documented boundary.
export const associatedBoundCases = [
  [
    "associated bounds native: copy-bound",
    "trait A{type Item;}struct S;impl A for S{type Item=u8;}fn f<T:A<Item:Copy>>(x:T::Item)->(T::Item,T::Item){(x,x)}fn main(){let p=f::<S>(7);println!(\"{} {}\",p.0,p.1);}",
    "7 7\n"
  ],
  [
    "associated bounds native: multiple-bounds",
    "trait A{type Item;}struct S;impl A for S{type Item=u8;}fn f<T:A<Item:Copy+std::fmt::Display>>(x:T::Item)->T::Item{println!(\"{}\",x);x}fn main(){println!(\"{}\",f::<S>(7));}",
    "7\n7\n"
  ],
  [
    "associated bounds native: nested-equality",
    "trait A{type Item;}trait B{type Out;}struct S;struct V;impl A for S{type Item=V;}impl B for V{type Out=u8;}fn f<T:A<Item:B<Out=u8>>>(x:<<T as A>::Item as B>::Out)->u8{x}fn main(){println!(\"{}\",f::<S>(7));}",
    "7\n"
  ],
  [
    "associated bounds native: repeat-bounds",
    "trait A{type Item;}fn f<T:A<Item:Copy,Item:Copy>>(){}fn main(){}",
    ""
  ],
  [
    "associated bounds native: equality-plus-bound",
    "trait A{type Item;}fn f<T:A<Item=u8,Item:Copy>>(){}fn main(){}",
    ""
  ],
  [
    "associated bounds native: contradictory-unused",
    "trait A{type Item;}fn f<T:A<Item=String,Item:Copy>>(){}fn main(){}",
    ""
  ],
  [
    "associated bounds native: empty-bound",
    "trait A{type Item;}struct S;impl A for S{type Item=u8;}fn f<T:A<Item:>>(){}fn main(){f::<S>();}",
    ""
  ],
  [
    "associated bounds native: trailing-plus",
    "trait A{type Item;}struct S;impl A for S{type Item=u8;}fn f<T:A<Item:Copy+>>(){}fn main(){f::<S>();}",
    ""
  ],
  [
    "associated bounds native: parenthesized-bound",
    "trait A{type Item;}struct S;impl A for S{type Item=u8;}fn f<T:A<Item:(Copy)>>(){}fn main(){f::<S>();}",
    ""
  ],
  [
    "associated bounds native: supertrait-bound",
    "trait A{type Item;}trait B:A<Item:Copy>{}struct S;impl A for S{type Item=u8;}impl B for S{}fn main(){}",
    ""
  ],
  [
    "associated bounds native: associated-item-bound",
    "trait A{type Item;}trait B{type Out:A<Item:Copy>;}struct S;struct V;impl A for S{type Item=u8;}impl B for V{type Out=S;}fn main(){}",
    ""
  ],
  [
    "associated bounds native: generic-impl-evidence",
    "trait A{type Item;}trait B{type Out:Copy;}struct V<T>(T);impl<T:A<Item:Copy>>B for V<T>{type Out=T::Item;}fn main(){}",
    ""
  ],
  [
    "associated bounds native: equivalent-impl-method",
    "trait A{type Item;}trait B{fn f<T:A<Item:Copy>>();}struct S;impl B for S{fn f<T:A>() where T::Item:Copy {}}fn main(){}",
    ""
  ],
  [
    "associated bounds native: alias-bound-not-enforced",
    "trait A{type Item;}struct S;impl A for S{type Item=String;}type V<T:A<Item:Copy>>=T::Item;fn main(){let x:V<S>=String::from(\"ok\");println!(\"{}\",x);}",
    "ok\n"
  ],
  [
    "associated bounds native: nested-output-impl-inference",
    "trait A{type Item;}trait B{type Out;}trait C{type Value;}struct S;struct V;impl A for S{type Item=V;}impl B for V{type Out=u8;}impl<T:A<Item:B<Out=U>>,U>C for T{type Value=U;}fn main(){let x:<S as C>::Value=7;println!(\"{}\",x);}",
    "7\n"
  ],
  [
    "associated bounds native: declared-nested-projection-bound",
    "trait A{type Item:B<Out:Copy>;}trait B{type Out;}trait C{type Value:Copy;}struct W<T>(T);impl<T:A>C for W<T>{type Value=<<T as A>::Item as B>::Out;}fn main(){}",
    ""
  ],
  [
    "associated bounds native: declared-nested-projection-equality",
    "trait A{type Item:B<Out=u8>;}trait B{type Out;}trait C{type Value:Copy;}struct W<T>(T);impl<T:A>C for W<T>{type Value=<<T as A>::Item as B>::Out;}fn main(){}",
    ""
  ],
  [
    "associated bounds native: recursive-associated-bound",
    "trait A{type Item:A;}struct S;impl A for S{type Item=S;}fn f<T:A<Item:A<Item:A>>>(){}fn main(){f::<S>();}",
    ""
  ],
  [
    "associated bounds native: bound-with-trait-import",
    "mod m{pub trait B{fn get(self)->i32;}pub struct V;impl B for V{fn get(self)->i32{42}}}use m::B;trait A{type Item;}struct S;impl A for S{type Item=m::V;}fn f<T:A<Item:B>>(x:T::Item)->i32{x.get()}fn main(){println!(\"{}\",f::<S>(m::V));}",
    "42\n"
  ],
  [
    "associated bounds native: projected-bound-dispatch",
    "trait A{type Item;}trait B{fn get(self)->i32;}struct V;impl V{fn get(self)->i32{9}}impl B for V{fn get(self)->i32{42}}struct S;impl A for S{type Item=V;}fn f<T:A<Item:B>>(x:T::Item)->i32{x.get()}fn main(){println!(\"{}\",f::<S>(V));}",
    "42\n"
  ],
  [
    "associated bounds native: inherited-binding-owner",
    "trait A{type Item;}trait B:A{}struct S;impl A for S{type Item=u8;}impl B for S{}fn f<T:B<Item:Copy>>(x:T::Item)->(T::Item,T::Item){(x,x)}fn main(){let p=f::<S>(7);println!(\"{} {}\",p.0,p.1);}",
    "7 7\n"
  ],
  [
    "associated bounds native: child-member-precedence",
    "trait A{type Item;}trait B:A{type Item;}struct S;impl A for S{type Item=String;}impl B for S{type Item=u8;}fn f<T:B<Item:Copy>>(){}fn main(){f::<S>();}",
    ""
  ],
  [
    "associated bounds native: callable-output-bound",
    "trait A{type Item;}struct S;impl A for S{type Item=fn(i32)->i32;}fn add(x:i32)->i32{x+1}fn f<T:A<Item:Fn(i32)->i32>>(g:T::Item)->i32{g(41)}fn main(){println!(\"{}\",f::<S>(add));}",
    "42\n"
  ],
  [
    "associated bounds native: return-impl-bound",
    "trait A{type Item;}struct S;impl A for S{type Item=u8;}fn f()->impl A<Item:Copy>{S}fn main(){let _x=f();}",
    ""
  ],
  [
    "associated bounds native: bound-label-hygiene",
    "trait A{type Item;}trait B<T>{}struct V;impl B<u8> for V{}struct S;impl A for S{type Item=V;}fn f<Item,T:A<Item:B<Item>>>(){}fn main(){f::<u8,S>();}",
    ""
  ],
  [
    "associated bounds: readonly omitted implementation bound",
    "trait A{type Item;}trait B{fn f<T:A<Item:Copy>>(x:T::Item)->T::Item;}struct S;struct V;impl A for V{type Item=u8;}impl B for S{fn f<T:A>(x:T::Item)->T::Item{x}}fn main(){println!(\"{}\",S::f::<V>(7));}",
    "7\n"
  ],
  [
    "associated bounds: generic method inline and where bounds",
    "trait A{type Item;}trait B{fn f<T:A<Item:Copy>>(x:T::Item)->(T::Item,T::Item);}struct S;struct V;impl A for V{type Item=u8;}impl B for S{fn f<T:A>(x:T::Item)->(T::Item,T::Item) where T::Item:Copy{(x,x)}}fn main(){let p=S::f::<V>(7);println!(\"{} {}\",p.0,p.1);}",
    "7 7\n"
  ],
  [
    "associated bounds: projected Fn can be called twice without Copy",
    "trait A{type Item;}struct S;impl A for S{type Item=fn(i32)->i32;}fn add(x:i32)->i32{x+1}fn f<T:A<Item:Fn(i32)->i32>>(g:T::Item)->i32{g(1)+g(2)}fn main(){println!(\"{}\",f::<S>(add));}",
    "5\n"
  ],
  [
    "associated bounds: generic Fn can be called twice without Copy",
    "fn add(x:i32)->i32{x+1}fn f<F:Fn(i32)->i32>(g:F)->i32{g(1)+g(2)}fn main(){println!(\"{}\",f(add));}",
    "5\n"
  ],
  [
    "associated bounds: closure capture preserves generic Copy proof",
    "fn f<T:Copy>(x:T)->(T,T){let g=move ||(x,x);g()}fn main(){let p=f(7);println!(\"{} {}\",p.0,p.1);}",
    "7 7\n"
  ],
  [
    "associated bounds: closure capture preserves associated Copy proof",
    "trait A{type Item;}struct S;impl A for S{type Item=u8;}fn f<T:A<Item:Copy>>(x:T::Item)->(T::Item,T::Item){let g=move ||(x,x);g()}fn main(){let p=f::<S>(7);println!(\"{} {}\",p.0,p.1);}",
    "7 7\n"
  ],
  [
    "associated bounds: nested closure Copy proof",
    "trait A{type Item;}struct S;impl A for S{type Item=u8;}fn f<T:A<Item:Copy>>(x:T::Item)->(T::Item,T::Item){let g=move ||{let h=move ||(x,x);h()};g()}fn main(){let p=f::<S>(7);println!(\"{} {}\",p.0,p.1);}",
    "7 7\n"
  ],
  [
    "associated bounds: default method preserves explicit Self Copy",
    "trait A:Copy{fn pair(self)->(Self,Self){(self,self)}}#[derive(Copy,Clone)]struct S(u8);impl A for S{}fn main(){let p=S(7).pair();println!(\"{} {}\",p.0.0,p.1.0);}",
    "7 7\n"
  ],
  [
    "associated bounds: struct fields retain associated bounds",
    "trait A{type Item;}struct S;impl A for S{type Item=u8;}struct W<T:A<Item:Copy>>{v:T::Item}impl<T:A<Item:Copy>>W<T>{fn pair(self)->(T::Item,T::Item){(self.v,self.v)}}fn main(){let p=W::<S>{v:7}.pair();println!(\"{} {}\",p.0,p.1);}",
    "7 7\n"
  ],
  [
    "associated bounds: where clause associated bounds",
    "trait A{type Item;}struct S;impl A for S{type Item=u8;}fn f<T>(x:T::Item)->(T::Item,T::Item) where T:A<Item:Copy>{(x,x)}fn main(){let p=f::<S>(7);println!(\"{} {}\",p.0,p.1);}",
    "7 7\n"
  ],
  [
    "associated bounds: nested bounds output type inference",
    "trait A{type Item;}trait B{type Out;}struct S;struct V;impl A for S{type Item=V;}impl B for V{type Out=u8;}fn f<T:A<Item:B<Out=U>>,U:Copy>(t:T,x:U)->(U,U){(x,x)}fn main(){let p=f(S,7);println!(\"{} {}\",p.0,p.1);}",
    "7 7\n"
  ],
  [
    "associated bounds: nested projection Copy in helper output",
    "trait A{type Item:B<Out:Copy>;}trait B{type Out;}struct S;struct V;impl A for S{type Item=V;}impl B for V{type Out=u8;}fn id<T:A>(x:<<T as A>::Item as B>::Out)-><<T as A>::Item as B>::Out{x}fn f<T:A>(x:<<T as A>::Item as B>::Out)->(<<T as A>::Item as B>::Out,<<T as A>::Item as B>::Out){let y=id::<T>(x);(y,y)}fn main(){let p=f::<S>(7);println!(\"{} {}\",p.0,p.1);}",
    "7 7\n"
  ],
  [
    "associated bounds: parameterized trait projected bound",
    "trait A<T>{type Item;}trait B<T>{fn get(self)->T;}struct V;impl B<u8> for V{fn get(self)->u8{7}}struct S;impl A<bool> for S{type Item=V;}fn f<T:A<bool,Item:B<u8>>>(x:<T as A<bool>>::Item)->u8{x.get()}fn main(){println!(\"{}\",f::<S>(V));}",
    "7\n"
  ],
  [
    "associated bounds: associated const projected Copy",
    "trait A{type Item:Copy;const N:Self::Item;}struct S;impl A for S{type Item=u8;const N:u8=7;}fn f<T:A<Item:Copy>>()->(T::Item,T::Item){let x=T::N;(x,x)}fn main(){let p=f::<S>();println!(\"{} {}\",p.0,p.1);}",
    "7 7\n"
  ],
  [
    "associated bounds: bound does not implicitly require Sized",
    "trait A{type Item:?Sized;}struct S;impl A for S{type Item=str;}fn f<T:A<Item:std::fmt::Display>>(){}fn main(){f::<S>();}",
    ""
  ],
  [
    "associated bounds: equation and bound from separate clauses",
    "trait A{type Item;}struct S;impl A for S{type Item=u8;}fn f<T:A<Item=U>+A<Item:Copy>,U>(x:U)->(U,U){(x,x)}fn main(){let p=f::<S,_>(7);println!(\"{} {}\",p.0,p.1);}",
    "7 7\n"
  ],
  [
    "associated bounds: generic callable signature retains binder scope",
    "trait A{type Item;}struct S;impl A for S{type Item=fn(u8)->u8;}fn add(x:u8)->u8{x+1}fn f<T:A<Item:Fn(U)->U>,U:Copy>(g:T::Item,x:U)->U{g(g(x))}fn main(){println!(\"{}\",f::<S,_>(add,5u8));}",
    "7\n"
  ],
  [
    "associated bounds: projected array-repeat Copy",
    "trait A{type Item;}struct S;impl A for S{type Item=u8;}fn f<T:A<Item:Copy>>(x:T::Item)->[T::Item;2]{[x;2]}fn main(){let p=f::<S>(7);println!(\"{} {}\",p[0],p[1]);}",
    "7 7\n"
  ],
  [
    "associated bounds: qualified constant retains abstract output",
    "trait A{type Item:Copy;const N:Self::Item;}struct S;impl A for S{type Item=u8;const N:u8=7;}fn f<T:A>()->(T::Item,T::Item){let x=<T as A>::N;(x,x)}fn main(){let p=f::<S>();println!(\"{} {}\",p.0,p.1);}",
    "7 7\n"
  ],
  [
    "associated bounds: inherent constant type remains independent of binder",
    "struct W<T>(T);impl<T:Copy>W<T>{const N:(u8,u8)=(7,7);}fn f<T:Copy>()->((u8,u8),(u8,u8)){let x=W::<T>::N;(x,x)}fn main(){let p=f::<bool>();println!(\"{} {}\",p.0.0,p.1.0);}",
    "7 7\n"
  ]
];

export const associatedBoundCompileFailCases = [
  [
    "associated bounds native: copy-failure",
    "trait A{type Item;}struct S;impl A for S{type Item=String;}fn f<T:A<Item:Copy>>(){}fn main(){f::<S>();}",
    "E0277"
  ],
  [
    "associated bounds native: relaxed-sized-binding",
    "trait A{type Item:?Sized;}fn f<T:A<Item:?Sized>>(){}fn main(){}",
    "E0229"
  ],
  [
    "associated bounds native: relaxed-copy-binding",
    "trait A{type Item;}fn f<T:A<Item:?Copy>>(){}fn main(){}",
    "E0229"
  ],
  [
    "associated bounds native: unknown-empty-member",
    "trait A{type Item;}fn f<T:A<Missing:>>(){}fn main(){}",
    "E0220"
  ],
  [
    "associated bounds native: unknown-nested-bound",
    "trait A{type Item;}fn f<T:A<Item:Missing>>(){}fn main(){}",
    "E0405"
  ],
  [
    "associated bounds native: nested-unknown-member",
    "trait A{type Item;}trait B{type Out;}fn f<T:A<Item:B<Missing:Copy>>>(){}fn main(){}",
    "E0220"
  ],
  [
    "associated bounds native: supertrait-bad-bound",
    "trait A{type Item;}trait B:A<Item:Copy>{}struct S;impl A for S{type Item=String;}impl B for S{}fn main(){}",
    "E0277"
  ],
  [
    "associated bounds native: associated-item-bad-bound",
    "trait A{type Item;}trait B{type Out:A<Item:Copy>;}struct S;struct V;impl A for S{type Item=String;}impl B for V{type Out=S;}fn main(){}",
    "E0277"
  ],
  [
    "associated bounds native: generic-impl-missing-evidence",
    "trait A{type Item;}trait B{type Out:Copy;}struct V<T>(T);impl<T:A>B for V<T>{type Out=T::Item;}fn main(){}",
    "E0277"
  ],
  [
    "associated bounds native: stricter-impl-method",
    "trait A{type Item;}trait B{fn f<T:A>();}struct S;impl B for S{fn f<T:A<Item:Copy>>() {}}fn main(){}",
    "E0276"
  ],
  [
    "associated bounds native: noninjective-bound-input",
    "trait A{type Item;}trait B<T>{}trait C{}struct W<T>(T);impl<T:A<Item:B<U>>,U>C for W<T>{}fn main(){}",
    "E0207"
  ],
  [
    "associated bounds native: bound-does-not-import-trait",
    "mod m{pub trait B{fn get(self)->i32;}pub struct V;impl B for V{fn get(self)->i32{42}}}trait A{type Item;}struct S;impl A for S{type Item=m::V;}fn f<T:A<Item:m::B>>(x:T::Item)->i32{x.get()}fn main(){println!(\"{}\",f::<S>(m::V));}",
    "E0599"
  ],
  [
    "associated bounds native: ambiguous-binding-owner",
    "trait A{type Item;}trait B{type Item;}trait C:A+B{}fn f<T:C<Item:Copy>>(){}fn main(){}",
    "E0222"
  ],
  [
    "associated bounds native: impl-head-bound-forbidden",
    "trait A{type Item;}struct S;impl A<Item:Copy> for S{type Item=u8;}fn main(){}",
    "E0229"
  ],
  [
    "associated bounds: instantiated impl body does not inherit omitted Copy",
    "trait A{type Item;}trait B{fn f<T:A<Item:Copy>>(x:T::Item)->(T::Item,T::Item);}struct S;struct V;impl A for V{type Item=u8;}impl B for S{fn f<T:A>(x:T::Item)->(T::Item,T::Item){(x,x)}}fn main(){let _p=S::f::<V>(7);}",
    "E0382"
  ],
  [
    "associated bounds: concrete layout does not grant generic Copy",
    "fn f<T>(x:T)->(T,T){(x,x)}fn main(){let _p=f(7);}",
    "E0382"
  ],
  [
    "associated bounds: concrete layout does not grant projected Copy",
    "trait A{type Item;}struct S;impl A for S{type Item=u8;}fn f<T:A>(x:T::Item)->(T::Item,T::Item){(x,x)}fn main(){let _p=f::<S>(7);}",
    "E0382"
  ],
  [
    "associated bounds: unbounded captured origin cannot borrow another proof",
    "trait A{type Item;}struct S;impl A for S{type Item=u8;}fn good<T:A<Item:Copy>>(x:T::Item)->(T::Item,T::Item){(x,x)}fn bad<T:A>(x:T::Item)->(T::Item,T::Item){let g=move ||(x,x);g()}fn main(){let _p=good::<S>(7);let _q=bad::<S>(9);}",
    "E0507"
  ],
  [
    "associated bounds: captured generic origin cannot use concrete Copy",
    "fn f<T>(x:T)->(T,T){let g=move ||(x,x);g()}fn main(){let _p=f(7);}",
    "E0507"
  ],
  [
    "associated bounds: nested bound failure through supertrait",
    "trait A{type Item;}trait B{type Out;}trait C:A<Item:B<Out:Copy>>{}struct S;struct V;impl A for S{type Item=V;}impl B for V{type Out=String;}impl C for S{}fn main(){}",
    "E0277"
  ],
  [
    "associated bounds: unused required method validates missing member",
    "trait A{type Item;}trait B{fn f<T:A<Missing:Copy>>();}fn main(){}",
    "E0220"
  ],
  [
    "associated bounds: unused required method validates nested trait arity",
    "trait A{type Item;}trait B<T>{}trait C{fn f<T:A<Item:B>>();}fn main(){}",
    "E0107"
  ],
  [
    "associated bounds: bound-only impl input is not inferred backwards",
    "trait A{type Item;}trait B<T>{}trait C{}struct W<T>(T);impl<T:A<Item:B<U>>,U>C for W<T>{}fn main(){}",
    "E0207"
  ],
  [
    "associated bounds: unavailable nested associated declaration proof",
    "trait A{type Item:B;}trait B{type Out;}trait C{type Value:Copy;}struct W<T>(T);impl<T:A>C for W<T>{type Value=<<T as A>::Item as B>::Out;}fn main(){}",
    "E0277"
  ],
  [
    "associated bounds: associated bounds do not change trait impl identity",
    "trait A{type Item;}trait B{}impl<T:A<Item:Copy>>B for T{}impl<T:A>B for T{}fn main(){}",
    "E0119"
  ],
  [
    "associated bounds: abstract constant output cannot gain Copy",
    "trait A{type Item;const N:Self::Item;}struct S;impl A for S{type Item=u8;const N:u8=7;}fn f<T:A>()->(T::Item,T::Item){let x=T::N;(x,x)}fn main(){let _p=f::<S>();}",
    "E0382"
  ],
  [
    "associated bounds: generic array-repeat needs declared Copy",
    "fn f<T>(x:T)->[T;2]{[x;2]}fn main(){let _p=f(7);}",
    "E0277"
  ],
  [
    "associated bounds: projected array-repeat needs declared Copy",
    "trait A{type Item;}struct S;impl A for S{type Item=u8;}fn f<T:A>(x:T::Item)->[T::Item;2]{[x;2]}fn main(){let _p=f::<S>(7);}",
    "E0277"
  ],
  [
    "associated bounds: default Self cannot gain concrete Copy",
    "trait A{fn f(self)->(Self,Self) where Self:Sized{(self,self)}}#[derive(Copy,Clone)]struct S;impl A for S{}fn main(){let _p=S.f();}",
    "E0382"
  ]
];
