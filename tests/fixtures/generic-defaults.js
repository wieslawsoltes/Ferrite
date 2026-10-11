// Exact source is shared with the native edition-2024 differential runner.
// Discovery boundaries are documented separately, not counted as conformance.
export const genericDefaultCases = [
  [
    "generic defaults native: struct annotation",
    "struct S<T=u8>(T);fn main(){let s:S=S(7);let x:u8=s.0;println!(\"{}\",x);}",
    "7\n"
  ],
  [
    "generic defaults native: struct inference ignores default",
    "struct S<T=u8>(T);fn main(){let s=S(7);let x:i32=s.0;println!(\"{}\",x);}",
    "7\n"
  ],
  [
    "generic defaults native: struct explicit partial",
    "struct S<T,U=u8>(T,U);fn main(){let s=S::<bool>(true,7);let x:u8=s.1;println!(\"{} {}\",s.0,x);}",
    "true 7\n"
  ],
  [
    "generic defaults native: struct explicit empty",
    "struct S<T=u8>(T);fn main(){let s=S::<>(7);let x:i32=s.0;println!(\"{}\",x);}",
    "7\n"
  ],
  [
    "generic defaults native: struct dependent default",
    "struct S<T=u8,U=T>(T,U);fn main(){let s:S<bool>=S(true,false);println!(\"{} {}\",s.0,s.1);}",
    "true false\n"
  ],
  [
    "generic defaults native: struct partial dependent underscore",
    "struct S<T,U=T>(T,U);fn main(){let s=S::<_>(7u8,8u8);println!(\"{} {}\",s.0,s.1);}",
    "7 8\n"
  ],
  [
    "generic defaults native: struct explicit inference override",
    "struct S<T=u8>(T);fn main(){let s:S<_>=S(300);println!(\"{}\",s.0);}",
    "300\n"
  ],
  [
    "generic defaults native: bare associated method inference",
    "struct S<T=u8>(T);impl<T>S<T>{fn new(x:T)->Self{S(x)}}fn main(){let s=S::new(300);let x:i32=s.0;println!(\"{}\",x);}",
    "300\n"
  ],
  [
    "generic defaults native: partial associated method defaults",
    "struct S<T,U=u8>(T,U);impl<T,U>S<T,U>{fn new(x:T,y:U)->Self{S(x,y)}}fn main(){let s=S::<bool>::new(true,7);let x:u8=s.1;println!(\"{} {}\",s.0,x);}",
    "true 7\n"
  ],
  [
    "generic defaults native: enum default annotation",
    "enum E<T=u8>{V(T)}fn main(){let e:E=E::V(7);match e{E::V(x)=>{let y:u8=x;println!(\"{}\",y);}}}",
    "7\n"
  ],
  [
    "generic defaults native: enum bare inference",
    "enum E<T=u8>{V(T)}fn main(){let e=E::V(300);match e{E::V(x)=>{let y:i32=x;println!(\"{}\",y);}}}",
    "300\n"
  ],
  [
    "generic defaults native: enum partial turbofish",
    "enum E<T,U=u8>{V(T,U)}fn main(){let e=E::<bool>::V(true,7);match e{E::V(x,y)=>println!(\"{} {}\",x,y)}}",
    "true 7\n"
  ],
  [
    "generic defaults native: alias record ignores defaults",
    "struct S<T>{v:T}type A<T=u8>=S<T>;fn main(){let s=A{v:300};let x:i32=s.v;println!(\"{}\",x);}",
    "300\n"
  ],
  [
    "generic defaults native: alias enum ignores defaults",
    "enum E<T>{V(T)}type A<T=u8>=E<T>;fn main(){let e=A::V(300);match e{E::V(x)=>{let y:i32=x;println!(\"{}\",y);}}}",
    "300\n"
  ],
  [
    "generic defaults native: alias method ignores defaults",
    "struct S<T>(T);impl<T>S<T>{fn new(x:T)->Self{S(x)}}type A<T=u8>=S<T>;fn main(){let s=A::new(300);let x:i32=s.0;println!(\"{}\",x);}",
    "300\n"
  ],
  [
    "generic defaults native: default Self in trait",
    "trait A<R=Self>{fn f(self,x:R)->i32;}struct S;impl A for S{fn f(self,x:Self)->i32{7}}fn main(){println!(\"{}\",S.f(S));}",
    "7\n"
  ],
  [
    "generic defaults native: default Self in generic bound",
    "trait A<R=Self>{fn f(self,x:R)->i32;}struct S;impl A for S{fn f(self,x:Self)->i32{7}}fn invoke<T:A>(a:T,b:T)->i32{a.f(b)}fn main(){println!(\"{}\",invoke(S,S));}",
    "7\n"
  ],
  [
    "generic defaults native: default trait forward binding",
    "trait A<T=u8>{type Out;fn f()->T;}struct S;impl A for S{type Out=bool;fn f()->u8{7}}fn g<T:A<Out=bool>>()->u8{T::f()}fn main(){println!(\"{}\",g::<S>());}",
    "7\n"
  ],
  [
    "generic defaults native: default projection qualified",
    "trait A{type Item;}impl A for bool{type Item=u8;}struct S<T:A,U=<T as A>::Item>(T,U);fn main(){let s:S<bool>=S(true,7);println!(\"{}\",s.1);}",
    "7\n"
  ],
  [
    "generic defaults native: default bound param missing",
    "struct S<T,U:Copy=T>(T,U);fn main(){}",
    ""
  ],
  [
    "generic defaults native: default bound param present",
    "struct S<T:Copy,U:Copy=T>(T,U);fn main(){}",
    ""
  ],
  [
    "generic defaults native: default hidden by module alias",
    "mod m{pub type X=u8;pub struct S<T=X>(pub T);}type X=bool;fn main(){let s:m::S=m::S(7);let x:u8=s.0;println!(\"{}\",x);}",
    "7\n"
  ],
  [
    "generic defaults native: default record pattern explicit partial",
    "struct S<T,U=u8>{x:T,y:U}fn main(){let s=S{x:true,y:7u8};let S::<bool>{x,y}=s;println!(\"{} {}\",x,y);}",
    "true 7\n"
  ],
  [
    "generic defaults native: default trait leading mandatory",
    "trait A<T,U=u8>{fn f()->U;}struct S;impl A<bool> for S{fn f()->u8{7}}fn main(){println!(\"{}\",<S as A<bool>>::f());}",
    "7\n"
  ],
  [
    "generic defaults native: default generic alias partial inference",
    "struct S<T,U>(T,U);type A<T,U=u8>=S<T,U>;fn main(){let s:A<bool>=S(true,7);println!(\"{} {}\",s.0,s.1);}",
    "true 7\n"
  ],
  [
    "generic defaults native: concrete alias default bound",
    "type A<T:Copy=String>=T;fn main(){}",
    ""
  ],
  [
    "generic defaults native: supertrait sized Self default",
    "trait A<R=Self>{fn f(self,x:R)->i32;}trait B:Sized+A{}struct S;impl A for S{fn f(self,x:Self)->i32{7}}impl B for S{}fn g<T:B>(x:T,y:T)->i32{x.f(y)}fn main(){println!(\"{}\",g(S,S));}",
    "7\n"
  ],
  [
    "generic defaults native: supertrait concrete default",
    "trait A<T=u8>{fn get()->T;}trait B:A{}struct S;impl A for S{fn get()->u8{7}}impl B for S{}fn f<T:B>()->u8{T::get()}fn main(){println!(\"{}\",f::<S>());}",
    "7\n"
  ],
  [
    "generic defaults native: lexical Self explicit versus subject default",
    "trait A<R=Self>{fn f(self,x:R)->i32;}struct V;impl A for V{fn f(self,x:V)->i32{7}}struct W;impl W{fn g<T:A>(x:T,y:T)->i32{x.f(y)}}fn main(){println!(\"{}\",W::g(V,V));}",
    "7\n"
  ],
  [
    "generic defaults native: lexical Self explicit",
    "trait A<R=Self>{fn f(self,x:R)->i32;}struct V;struct W;impl A<W> for V{fn f(self,x:W)->i32{7}}impl W{fn g<T:A<Self>>(x:T,y:Self)->i32{x.f(y)}}fn main(){println!(\"{}\",W::g(V,W));}",
    "7\n"
  ],
  [
    "generic defaults native: where subject default",
    "trait A<R=Self>{fn f(self,x:R)->i32;}struct V;impl A for V{fn f(self,x:V)->i32{7}}fn g<T>(x:T,y:T)->i32 where T:A{x.f(y)}fn main(){println!(\"{}\",g(V,V));}",
    "7\n"
  ],
  [
    "generic defaults native: nested projection bound subject",
    "trait A<R=Self>{fn f(self,x:R)->i32;}trait B{type Item;}struct V;impl A for V{fn f(self,x:V)->i32{7}}struct W;impl B for W{type Item=V;}fn g<T:B<Item:A>>(x:T::Item,y:T::Item)->i32{x.f(y)}fn main(){println!(\"{}\",g::<W>(V,V));}",
    "7\n"
  ],
  [
    "generic defaults native: associated declaration subject",
    "trait A<R=Self>{fn f(self,x:R)->i32;}trait B{type Item:A;}struct V;impl A for V{fn f(self,x:V)->i32{7}}struct W;impl B for W{type Item=V;}fn g<T:B>(x:T::Item,y:T::Item)->i32{x.f(y)}fn main(){println!(\"{}\",g::<W>(V,V));}",
    "7\n"
  ],
  [
    "generic defaults native: equality plus generic default subject",
    "trait A<R=Self>{type Item;fn f(self,x:R)->i32;}struct V;impl A for V{type Item=u8;fn f(self,x:V)->i32{7}}fn g<T:A<Item=u8>>(x:T,y:T)->i32{x.f(y)}fn main(){println!(\"{}\",g(V,V));}",
    "7\n"
  ],
  [
    "generic defaults native: impl obligation subject default",
    "trait A<R=Self>{}impl A for u8{}struct S<T>(T);impl<T:A>S<T>{fn get(self)->T{self.0}}fn main(){println!(\"{}\",S(7u8).get());}",
    "7\n"
  ],
  [
    "generic defaults native: impl obligation explicit lexical Self",
    "trait A<R=Self>{}struct S<T>(T);impl A<S<u8>> for u8{}impl<T:A<Self>> S<T>{fn get(self)->T{self.0}}fn main(){println!(\"{}\",S(7u8).get());}",
    "7\n"
  ],
  [
    "generic defaults native: default associated output concrete",
    "trait A<R=u8>{type Item;}struct S;impl A for S{type Item=bool;}fn main(){let x:<S as A>::Item=true;println!(\"{}\",x);}",
    "true\n"
  ],
  [
    "generic defaults native: default associated const",
    "trait A<R=u8>{const N:R;}struct S;impl A for S{const N:u8=7;}fn main(){println!(\"{}\",<S as A>::N);}",
    "7\n"
  ],
  [
    "generic defaults native: inherent constant default owner",
    "struct S<T=u8>(T);impl<T>S<T>{const N:i32=7;}fn main(){println!(\"{}\",S::<u8>::N);}",
    "7\n"
  ],
  [
    "generic defaults native: default trait distinct instantiations",
    "trait A<T=u8>{fn f()->T;}struct S;impl A for S{fn f()->u8{7}}impl A<bool> for S{fn f()->bool{true}}fn main(){println!(\"{} {}\",<S as A>::f(),<S as A<bool>>::f());}",
    "7 true\n"
  ],
  [
    "generic defaults native: default generic namespace identity",
    "struct T;struct S<T,U=T>(T,U);fn main(){let s=S::<_>(T,T);let S(a,b)=s;}",
    ""
  ],
  [
    "generic defaults native: struct nested dependent",
    "struct S<T,U=(T,T)>(T,U);fn main(){let s=S::<_>(7u8,(8,9));println!(\"{} {} {}\",s.0,s.1.0,s.1.1);}",
    "7 8 9\n"
  ],
  [
    "generic defaults native: struct array dependent",
    "struct S<T,U=[T;2]>(T,U);fn main(){let s=S::<_>(7u8,[8,9]);println!(\"{} {}\",s.0,s.1[1]);}",
    "7 9\n"
  ],
  [
    "generic defaults native: struct enum dependent",
    "enum E<T,U=T>{V(T,U)}fn main(){match E::<_>::V(7u8,8){E::V(a,b)=>println!(\"{} {}\",a,b)}}",
    "7 8\n"
  ],
  [
    "generic defaults native: struct record reverse inference suffix",
    "struct S<T,U=T>{a:T,b:U}fn main(){let s=S::<_>{a:7,b:8u8};let x:u8=s.a;println!(\"{} {}\",x,s.b);}",
    "7 8\n"
  ],
  [
    "generic defaults native: struct tuple reverse inference suffix",
    "struct S<T,U=T>(T,U);fn main(){let s=S::<_>(7,8u8);let x:u8=s.0;println!(\"{} {}\",x,s.1);}",
    "7 8\n"
  ],
  [
    "generic defaults native: projected constructor default",
    "trait A{type Item;}impl A for bool{type Item=u8;}struct S<T:A,U=<T as A>::Item>(T,U);fn main(){let s=S::<bool>(true,7);println!(\"{}\",s.1);}",
    "7\n"
  ],
  [
    "generic defaults native: projected underscore constructor default",
    "trait A{type Item;}impl A for bool{type Item=u8;}struct S<T:A,U=<T as A>::Item>(T,U);fn main(){let s=S::<_>(true,7);println!(\"{}\",s.1);}",
    "7\n"
  ],
  [
    "generic defaults native: chain default",
    "struct S<A,B=A,C=(A,B)>(A,B,C);fn main(){let s=S::<u8>(1,2,(3,4));println!(\"{} {} {} {}\",s.0,s.1,s.2.0,s.2.1);}",
    "1 2 3 4\n"
  ],
  [
    "generic defaults native: chain hole default",
    "struct S<A,B=A,C=(A,B)>(A,B,C);fn main(){let s=S::<_>(1,2u8,(3,4));println!(\"{} {} {} {}\",s.0,s.1,s.2.0,s.2.1);}",
    "1 2 3 4\n"
  ],
  [
    "generic defaults native: function pointer default",
    "fn inc(x:u8)->u8{x+1}struct S<T=fn(u8)->u8>(T);fn main(){let s:S=S(inc);println!(\"{}\",(s.0)(7));}",
    "8\n"
  ],
  [
    "generic defaults native: default in generic signature",
    "struct S<T,U=T>(T,U);fn f<T>(s:S<T>)->T{s.1}fn main(){println!(\"{}\",f(S(7u8,8u8)));}",
    "8\n"
  ],
  [
    "generic defaults native: default in struct field",
    "struct S<T=u8>(T);struct W{v:S}fn main(){let w=W{v:S(7)};println!(\"{}\",w.v.0);}",
    "7\n"
  ],
  [
    "generic defaults native: default in enum payload",
    "struct S<T=u8>(T);enum E{V(S)}fn main(){match E::V(S(7)){E::V(s)=>println!(\"{}\",s.0)}}",
    "7\n"
  ],
  [
    "generic defaults native: nested alias defaults",
    "struct S<T=u8>(T);type A<T=u8>=S<T>;type B=A;fn main(){let s:B=S(7);println!(\"{}\",s.0);}",
    "7\n"
  ],
  [
    "generic defaults native: default forward nominal declaration",
    "struct S<T=V>(T);struct V;fn main(){let s:S=S(V);}",
    ""
  ],
  [
    "generic defaults native: default shadow previous binder",
    "type T=u8;struct S<T,U=T>(T,U);fn main(){let s:S<bool>=S(true,false);println!(\"{}\",s.1);}",
    "false\n"
  ],
  [
    "generic defaults native: qual projection missing bound",
    "trait A{type Item;}struct S<T,U=<T as A>::Item>(T,U);fn main(){}",
    ""
  ],
  [
    "generic defaults native: default generic trait previous",
    "trait A<T,U=T>{fn f(x:T)->U;}struct S;impl A<u8> for S{fn f(x:u8)->u8{x}}fn main(){println!(\"{}\",<S as A<u8>>::f(7));}",
    "7\n"
  ],
  [
    "generic defaults native: default declaration requires prior bounds concrete",
    "trait A<T>{}impl A<bool> for u8{}struct S<T,U:A<T>=u8>(T,U);fn main(){}",
    ""
  ],
  [
    "generic defaults native: default declaration requires prior bounds at use",
    "trait A<T>{}impl A<bool> for u8{}struct S<T,U:A<T>=u8>(T,U);fn main(){let s:S<bool>=S(true,7);}",
    ""
  ],
  [
    "generic defaults native: default nested nominal bound symbolic",
    "struct C<T:Copy>(T);struct S<T,U=C<T>>(T,U);fn main(){}",
    ""
  ],
  [
    "generic defaults native: default signature trait dependent default",
    "trait A<T,U=T>{}struct S;impl A<u8> for S{}fn f<T:A<u8>>(){}fn main(){f::<S>();}",
    ""
  ],
  [
    "generic defaults native: where valid concrete default",
    "struct S<T=String>(T) where T:Clone;fn main(){}",
    ""
  ],
  [
    "generic defaults native: chain defaults do not replace prior binders in definition",
    "trait A<T>{}impl A<bool> for u8{}struct S<T=i32,U:A<T>=u8>(T,U);fn main(){}",
    ""
  ],
  [
    "generic defaults native: sized tuple Self default",
    "trait A<T=(Self,)>{}fn main(){}",
    ""
  ],
  [
    "generic defaults native: sized Self default bound on where clause",
    "trait A<R=Self> where Self:Sized{}struct S;impl A for S{}fn main(){}",
    ""
  ],
  [
    "generic defaults native: default private explicit replacement",
    "mod m{struct D;pub struct S<T=D>(pub T);}fn main(){let x:m::S<u8>=m::S(7);println!(\"{}\",x.0);}",
    "7\n"
  ],
  [
    "generic defaults native: private default contained in module",
    "mod m{struct D;pub struct S<T=D>(T);impl S{pub fn n()->i32{7}}pub fn n()->i32{S::n()}}fn main(){println!(\"{}\",m::n());}",
    "7\n"
  ],
  [
    "generic defaults native: default trait private explicit replacement",
    "mod m{struct D;pub trait A<T=D>{fn n()->i32;}pub struct V;impl A<u8> for V{fn n()->i32{7}}}fn main(){println!(\"{}\",<m::V as m::A<u8>>::n());}",
    "7\n"
  ],
  [
    "generic defaults native: default type parameter collision",
    "struct T;struct P<T,U=T>(T,U);fn main(){let x=P::<T>(T,T);}",
    ""
  ],
  [
    "generic defaults native: default trait concrete name collision",
    "struct T;trait A<T=u8,U=T>{fn get()->U;}struct S;impl A<T> for S{fn get()->T{T}}fn main(){let _:T=<S as A<T>>::get();}",
    ""
  ],
  [
    "generic defaults native: partial record pattern hole equality",
    "struct S<T,U=T>{a:T,b:U}fn main(){let s=S{a:7u8,b:8u8};let S::<_>{a,b}=s;println!(\"{} {}\",a,b);}",
    "7 8\n"
  ],
  [
    "generic defaults native: partial constructor event ordering",
    "struct S<T,U=T>{a:T,b:U}fn a()->u8{print!(\"a\");7}fn b()->u8{print!(\"b\");8}fn main(){let s=S::<_>{b:b(),a:a()};println!(\" {} {}\",s.a,s.b);}",
    "ba 7 8\n"
  ],
  [
    "generic defaults native: generic default in alias output projection",
    "trait A{type Item;}impl A for bool{type Item=u8;}type X<T=bool>=<T as A>::Item;fn main(){let x:X=7;println!(\"{}\",x);}",
    "7\n"
  ],
  [
    "generic defaults native: qualified trait default generic scope",
    "trait A<T=u8>{type Item;}struct S;impl A for S{type Item=bool;}fn f<T:A>(x:T::Item)->T::Item{x}fn main(){println!(\"{}\",f::<S>(true));}",
    "true\n"
  ],
  [
    "generic defaults native: default trait predicate output proof",
    "trait A<R=Self>{type Item:Copy;}struct S;impl A for S{type Item=u8;}fn f<T:A<Item:Copy>>(x:T::Item)->(T::Item,T::Item){(x,x)}fn main(){let p=f::<S>(7);println!(\"{} {}\",p.0,p.1);}",
    "7 7\n"
  ],
  [
    "generic defaults native: default trait associated nested method Self",
    "trait A<R=Self>{fn f(self,r:R)->i32;}trait B{type Item:A;}struct S;impl A for S{fn f(self,r:S)->i32{7}}struct C;impl B for C{type Item=S;}struct D;impl D{fn g<T:B<Item:A>>(a:T::Item,b:T::Item)->i32{a.f(b)}}fn main(){println!(\"{}\",D::g::<C>(S,S));}",
    "7\n"
  ],
  [
    "generic defaults native: default parameter used in default function body",
    "trait A<T=u8>{fn get(x:T)->T{x}}struct S;impl A for S{}fn main(){println!(\"{}\",<S as A>::get(7));}",
    "7\n"
  ],
  [
    "generic defaults native: default Self default function body",
    "trait A<R=Self>:Sized{fn first(self,other:R)->Self{self}}struct S;impl A for S{}fn main(){let _:S=S.first(S);}",
    ""
  ],
  [
    "generic defaults native: default enum in patterns",
    "enum E<T=u8,U=T>{V(T,U)}fn main(){match E::<u8>::V(7,8){E::<u8>::V(a,b)=>println!(\"{} {}\",a,b)}}",
    "7 8\n"
  ],
  [
    "generic defaults native: default function pointer qualified signature",
    "struct S<T=u8>(T);fn f(x:S)->u8{x.0}fn main(){let g:fn(S)->u8=f;println!(\"{}\",g(S(7)));}",
    "7\n"
  ],
  [
    "generic defaults native: default aggregate const",
    "struct S<T=u8>(T);const C:S=S(7);fn main(){println!(\"{}\",C.0);}",
    "7\n"
  ],
  [
    "generic defaults native: default valid recursive explicit termination",
    "struct S<T=Option<S<u8>>>(T);fn main(){let x:S=S(None);}",
    ""
  ],
  [
    "generic defaults native: default trait same type partial canonical",
    "trait A<T=u8,U=T>{fn get()->U;}struct S;impl A<bool> for S{fn get()->bool{true}}fn f<T:A<bool>>()->bool{T::get()}fn main(){println!(\"{}\",f::<S>());}",
    "true\n"
  ]
];

export const genericDefaultCompileFailCases = [
  [
    "generic defaults native: struct omitted dependent aliasing",
    "struct S<T,U=T>(T,U);fn main(){let s=S::<_>(7u8,8i32);println!(\"{} {}\",s.0,s.1);}",
    "E0308"
  ],
  [
    "generic defaults native: default projection shorthand",
    "trait A{type Item;}impl A for bool{type Item=u8;}struct S<T:A,U=T::Item>(T,U);fn main(){let s:S<bool>=S(true,7);println!(\"{}\",s.1);}",
    "E0220"
  ],
  [
    "generic defaults native: default unknown unused",
    "struct S<T=Missing>(T);fn main(){}",
    "E0412"
  ],
  [
    "generic defaults native: default bound unused",
    "struct S<T:Copy=String>(T);fn main(){}",
    "E0277"
  ],
  [
    "generic defaults native: default trait bound unused",
    "trait A<T:Copy=String>{}fn main(){}",
    "E0277"
  ],
  [
    "generic defaults native: default bound not used with explicit",
    "struct S<T:Copy=String>(T);fn main(){let s=S::<u8>(7);println!(\"{}\",s.0);}",
    "E0277"
  ],
  [
    "generic defaults native: default later binder",
    "struct S<T=U,U=u8>(T,U);fn main(){}",
    "E0128"
  ],
  [
    "generic defaults native: default self binder",
    "struct S<T=T>(T);fn main(){}",
    "E0128"
  ],
  [
    "generic defaults native: default Self in nominal",
    "struct S<T=Self>(T);fn main(){}",
    "E0735"
  ],
  [
    "generic defaults native: default cycle unused",
    "struct S<T=S>(T);fn main(){}",
    "E0391"
  ],
  [
    "generic defaults native: default alias cycle",
    "type A<T=A>=T;fn main(){}",
    "E0391"
  ],
  [
    "generic defaults native: default trait on supertrait",
    "trait A<R=Self>{fn f(self,x:R)->i32;}trait B:A{}struct S;impl A for S{fn f(self,x:Self)->i32{7}}impl B for S{}fn g<T:B>(x:T,y:T)->i32{x.f(y)}fn main(){println!(\"{}\",g(S,S));}",
    "E0277"
  ],
  [
    "generic defaults native: default record pattern mismatch",
    "struct S<T,U=u8>{x:T,y:U}fn main(){let s=S{x:true,y:7i32};let S::<bool>{x,y}=s;println!(\"{} {}\",x,y);}",
    "E0308"
  ],
  [
    "generic defaults native: default trait unknown unused",
    "trait A<T=Missing>{}fn main(){}",
    "E0412"
  ],
  [
    "generic defaults native: default trait overlap",
    "trait A<T=u8>{}struct S;impl A for S{}impl A<u8> for S{}fn main(){}",
    "E0119"
  ],
  [
    "generic defaults native: projected constructor mismatch",
    "trait A{type Item;}impl A for bool{type Item=u8;}struct S<T:A,U=<T as A>::Item>(T,U);fn main(){let s=S::<bool>(true,7i32);}",
    "E0308"
  ],
  [
    "generic defaults native: private declaration type default",
    "mod m{struct D;pub struct S<T=D>(T);impl S{pub fn n()->i32{7}}}fn main(){println!(\"{}\",m::S::n());}",
    "E0603"
  ],
  [
    "generic defaults native: default placeholder nested",
    "struct S<T=(u8,_)>(T);fn main(){}",
    "E0121"
  ],
  [
    "generic defaults native: default unknown overridden",
    "struct S<T=Missing>(T);fn main(){let s=S::<u8>(7);}",
    "E0412"
  ],
  [
    "generic defaults native: partially missing mandatory",
    "struct S<T,U,V=u8>(T,U,V);fn main(){let s=S::<bool>(true,false,7);}",
    "E0107"
  ],
  [
    "generic defaults native: no mandatory annotation",
    "struct S<T,U=u8>(T,U);fn main(){let s:S=S(true,7);}",
    "E0107"
  ],
  [
    "generic defaults native: explicit extra args",
    "struct S<T=u8>(T);fn main(){let s=S::<u8,bool>(7);}",
    "E0107"
  ],
  [
    "generic defaults native: qual projection in tuple shorthand",
    "trait A{type Item;}struct S<T:A,U=(T::Item,u8)>(T,U);fn main(){}",
    "E0220"
  ],
  [
    "generic defaults native: used symbolic default bound",
    "struct S<T,U:Copy=T>(T,U);fn main(){let s:S<String>=S(String::from(\"a\"),String::from(\"b\"));}",
    "E0277"
  ],
  [
    "generic defaults native: default nested nominal bound invalid",
    "struct C<T:Copy>(T);struct S<T=C<String>>(T);fn main(){}",
    "E0277"
  ],
  [
    "generic defaults native: where invalid concrete default",
    "struct S<T=String>(T) where T:Copy;fn main(){}",
    "E0277"
  ],
  [
    "generic defaults native: where invalid concrete trait default",
    "trait A<T=String> where T:Copy{}fn main(){}",
    "E0277"
  ],
  [
    "generic defaults native: where invalid compound default",
    "struct S<T=u8>(T) where Vec<T>:Copy;fn main(){}",
    "E0277"
  ],
  [
    "generic defaults native: chain defaults bad use",
    "trait A<T>{}impl A<bool> for u8{}struct S<T=i32,U:A<T>=u8>(T,U);fn main(){let s:S=S(7,8);}",
    "E0277"
  ],
  [
    "generic defaults native: short projection hidden in qualified default",
    "trait A{type Item;}trait B<T>{type Out;}struct S<T:A,U=<T as B<T::Item>>::Out>(T,U);fn main(){}",
    "E0220"
  ],
  [
    "generic defaults native: default type expression with nested impl Trait",
    "struct S<T=Option<impl Copy>>(T);fn main(){}",
    "E0562"
  ],
  [
    "generic defaults native: default private in type annotation",
    "mod m{struct D;pub struct S<T=D>(pub T);pub fn make()->S{S(D)}}fn main(){let x:m::S=m::make();}",
    "E0603"
  ],
  [
    "generic defaults native: partial record pattern hole mismatch",
    "struct S<T,U=T>{a:T,b:U}fn main(){let s=S{a:7u8,b:8i32};let S::<_>{a,b}=s;}",
    "E0308"
  ],
  [
    "generic defaults native: default enum pattern mismatch",
    "enum E<T,U=u8>{V(T,U)}fn main(){match E::V(true,7i32){E::<bool>::V(a,b)=>{}}}",
    "E0308"
  ],
  [
    "generic defaults native: default recursive mutual nominal",
    "struct A<T=B>(T);struct B<T=A>(T);fn main(){}",
    "E0391"
  ],
  [
    "generic defaults native: default type checking unused nondefaults invalid bound",
    "struct S<T:Missing=u8>(T);fn main(){}",
    "E0405"
  ]
];
