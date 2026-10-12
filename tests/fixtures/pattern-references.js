// Exact Rust sources are shared with native-rustc differential validation.
export const patternReferenceCases = [
  ['reference-only match capture does not move an owned enum', 'fn main(){let p=Some(String::from("a"));let f=||match p{Some(ref r)=>r.len(),None=>0};println!("{} {}",f(),f());}', '1 1\n'],
  ['reference-only if-let capture does not move owned storage', 'fn main(){let p=String::from("a");let f=||if let ref r=p{r.len()}else{0usize};println!("{} {}",f(),f());}', '1 1\n'],
  ['mixed shared and mutable pattern capture is reusable', 'fn main(){let mut p=(String::from("a"),String::from("b"));let mut f=||{let(ref mut a,ref b)=p;a.push_str("!");b.len()};println!("{} {}",f(),f());}', '1 1\n'],
  ['wildcard guard may replace scalar before a reference-only arm', 'fn main(){let mut p=1;match p{_ if {p=2;false}=>{},ref r=>println!("{}",*r)}}', '2\n'],
  ['wildcard guard may replace tuple before a reference-only arm', 'fn main(){let mut p=(1,2);match p{_ if {p=(3,4);false}=>{},ref r=>println!("{}",r.0)}}', '3\n'],
  ['wildcard-only scalar match does not freeze unobserved storage', 'fn main(){let mut p=1;match p{_ if {p=2;false}=>{},_=>{}}println!("{}",p);}', '2\n'],
  ['wildcard-only tuple match does not freeze unobserved storage', 'fn main(){let mut p=(1,2);match p{_ if {p=(3,4);false}=>{},_=>{}}println!("{}",p.0);}', '3\n'],
  ['shared root leaves an owned source usable', 'fn main(){let x=String::from("value");let ref r=x;println!("{} {}",r.len(),x);}', '5 value\n'],
  ['mutable root updates original scalar storage', 'fn main(){let mut x=1;let ref mut r=x;*r=42;println!("{}",x);}', '42\n'],
  ['two shared pattern handles coexist', 'fn main(){let x=42;let ref a=x;let ref b=x;println!("{} {} {}",*a,*b,x);}', '42 42 42\n'],
  ['a last-use ends a mutable pattern loan', 'fn main(){let mut x=1;let ref mut r=x;*r+=1;x+=1;println!("{}",x);}', '3\n'],
  ['unused mutable pattern borrow expires before a new borrow', 'fn main(){let mut x=1;let ref mut r=x;let ref s=x;println!("{}",*s);}', '1\n'],
  ['tuple mutable sibling loans remain disjoint', 'fn main(){let mut p=(1,2);let(ref mut a,ref mut b)=p;*a+=2;*b+=3;println!("{} {}",p.0,p.1);}', '3 5\n'],
  ['move and mutable borrow share a tuple pattern', 'fn main(){let mut p=(String::from("owned"),2);let(a,ref mut b)=p;*b+=1;println!("{} {}",a,p.1);}', 'owned 3\n'],
  ['record shorthand reference modes', 'struct P{a:i32,b:i32}fn main(){let mut p=P{a:1,b:2};let P{ref mut a,ref b}=p;*a+=*b;println!("{} {}",p.a,p.b);}', '3 2\n'],
  ['renamed nested record and tuple references', 'struct P{v:(i32,i32)}fn main(){let mut p=P{v:(1,2)};let P{v:(ref mut a,ref b)}=p;*a+=*b;println!("{}",p.v.0);}', '3\n'],
  ['tuple struct reference projections', 'struct P(i32,i32);fn main(){let mut p=P(1,2);let P(ref mut a,ref b)=p;*a+=*b;println!("{}",p.0);}', '3\n'],
  ['fixed-array element reference projections', 'fn main(){let mut p=[1,2,3];let[ref mut a,_,ref mut b]=p;*a+=*b;*b=9;println!("{:?}",p);}', '[4, 2, 9]\n'],
  ['array ignored rest preserves fixed suffix', 'fn main(){let mut p=[1,2,3,4];let[ref mut a,..,ref mut b]=p;*a+=*b;*b=7;println!("{:?}",p);}', '[5, 2, 3, 7]\n'],
  ['borrow elements around an owned array rest', 'fn main(){let mut p=[1,2,3,4];let[ref mut a,middle @ ..,ref b]=p;*a+=*b;println!("{} {:?}",p[0],middle);}', '5 [2, 3]\n'],
  ['reference source address side effects run once', 'fn ix()->usize{print!("i");1}fn main(){let mut p=[1,2];let ref mut r=p[ix()];*r=7;println!(" {:?}",p);}', 'i [1, 7]\n'],
  ['pattern source address is fixed before body index mutation', 'fn main(){let mut p=[1,2];let mut i=0usize;let ref mut r=p[i];i=1;*r=8;println!("{} {:?}",i,p);}', '1 [8, 2]\n'],
  ['match mutable enum payload updates original enum', 'fn main(){let mut p=Some(1);match p{Some(ref mut r)=>*r+=2,None=>{}}println!("{}",p.unwrap());}', '3\n'],
  ['record enum payload borrowing respects storage order', 'enum P{V{a:i32,b:i32},N}fn main(){let mut p=P::V{a:1,b:2};match p{P::V{ref b,ref mut a}=>*a+=*b,P::N=>{}}println!("{}",match p{P::V{a,..}=>a,P::N=>0});}', '3\n'],
  ['tuple enum mutable payload siblings remain disjoint', 'enum P{V(i32,i32),N}fn main(){let mut p=P::V(1,2);match p{P::V(ref mut a,ref mut b)=>{*a+=*b;*b=7;},P::N=>{}}println!("{}",match p{P::V(a,b)=>a+b,_=>0});}', '10\n'],
  ['or-pattern shared references on variant-dependent paths', 'enum P{A(i32),B(i32)}fn f(p:P)->i32{match p{P::A(ref r)|P::B(ref r)=>*r}}fn main(){println!("{} {}",f(P::A(1)),f(P::B(2)));}', '1 2\n'],
  ['or-pattern mutable references on variant-dependent paths', 'enum P{A(i32),B(i32)}fn main(){let mut p=P::B(1);match p{P::A(ref mut r)|P::B(ref mut r)=>*r+=2}println!("{}",match p{P::A(v)|P::B(v)=>v});}', '3\n'],
  ['or-pattern aliases the same mutable binding once', 'fn main(){let mut p=(2,3);match p{(1,ref mut r)|(2,ref mut r)=>*r+=4,_=>{}}println!("{}",p.1);}', '7\n'],
  ['shared whole and shared nested aliases', 'fn main(){let p=(1,2);let ref w @ (ref a,_)=p;println!("{} {}",w.1,*a);}', '2 1\n'],
  ['mutable whole borrow observes Copy part before loan', 'fn main(){let mut p=(1,2);let ref mut w @ (x,_) = p;*w=(3,4);println!("{} {}",x,p.0);}', '1 3\n'],
  ['borrowed copied aggregate remains original storage', '#[derive(Copy,Clone)]struct P{v:i32}fn main(){let mut p=(P{v:1},P{v:2});let(ref mut a,b)=p;a.v+=1;println!("{} {} {}",p.0.v,b.v,p.1.v);}', '2 2 2\n'],
  ['if-let mutable borrow releases after body', 'fn main(){let mut p=Some(1);if let Some(ref mut r)=p{*r+=1;}p=Some(7);println!("{}",p.unwrap());}', '7\n'],
  ['failed if-let leaves source untouched', 'fn main(){let mut p:Option<i32>=None;if let Some(ref mut r)=p{*r=4;}p=Some(7);println!("{}",p.unwrap());}', '7\n'],
  ['let-else reference binding', 'fn main(){let mut p=Some(1);let Some(ref mut r)=p else{return;};*r=9;println!("{}",p.unwrap());}', '9\n'],
  ['while-let repeated mutable loans end before next header', 'fn main(){let mut p=Some(0);let mut n=0;while let Some(ref mut r)=p{*r+=1;n+=*r;if n==6{p=None;}}println!("{}",n);}', '6\n'],
  ['let-chain mutable pattern references', 'fn main(){let mut p=Some(1);if let Some(ref mut r)=p && *r>0{*r+=4;}println!("{}",p.unwrap());}', '5\n'],
  ['failed let-chain releases its reference binding', 'fn main(){let mut p=Some(1);if let Some(ref mut r)=p && *r>5{*r+=4;}else{p=Some(8);}println!("{}",p.unwrap());}', '8\n'],
  ['mutable reference is readable in a match guard', 'fn main(){let mut p=Some(1);match p{Some(ref mut r) if *r>0=>*r+=2,_=>{}}println!("{}",p.unwrap());}', '3\n'],
  ['failed guard releases candidate reference loans', 'fn main(){let mut p=Some(1);match p{Some(ref mut r) if *r>3=>*r=7,Some(ref mut r)=>*r+=2,None=>{}}println!("{}",p.unwrap());}', '3\n'],
  ['guard may mutate an unrelated sibling', 'fn main(){let mut p=(1,2);match p{(ref a,_) if {p.1+=1;true}=>println!("{} {}",*a,p.1),_=>{}}}', '1 3\n'],
  ['borrowing through an explicit mutable dereference', 'fn main(){let mut p=(1,2);let r=&mut p;let(ref mut a,ref mut b)=*r;*a+=1;*b+=1;println!("{} {}",p.0,p.1);}', '2 3\n'],
  ['returned reference source retains caller loan', 'fn relay(x:&mut i32)->&mut i32{x}fn main(){let mut x=1;let ref mut r=*relay(&mut x);*r+=1;println!("{}",x);}', '2\n'],
  ['function result borrows projected input not pointer storage', 'struct P{x:i32,y:i32}fn field(p:&mut P)->&mut i32{let P{ref mut x,..}=*p;x}fn main(){let mut p=P{x:1,y:2};*field(&mut p)=3;println!("{}",p.x);}', '3\n'],
  ['shared borrow of existing reference storage', 'fn main(){let x=42;let r=&x;let ref s=r;println!("{}",**s);}', '42\n'],
  ['shared reference-storage copy survives parent last-use', 'fn main(){let x=42;let r=&x;let ref s=r;let t=*s;println!("{}",*t);}', '42\n'],
  ['returned reference temporary has tracked inner storage', 'fn id(x:&i32)->&i32{x}fn main(){let x=42;let ref s=id(&x);println!("{}",**s);}', '42\n'],
  ['let-pattern scalar temporary lifetime extension', 'fn main(){let ref r=42;println!("{}",*r);}', '42\n'],
  ['let-pattern mutable temporary lifetime extension', 'fn main(){let ref mut r=41;*r+=1;println!("{}",*r);}', '42\n'],
  ['owned factory temporary is evaluated once and retained', 'fn make()->String{print!("m");String::from("a")}fn main(){let ref mut r=make();r.push_str("b");println!(" {}",*r);}', 'm ab\n'],
  ['nested owned temporary borrowing', 'fn main(){let(ref mut a,ref b)=(String::from("a"),String::from("b"));a.push_str("x");println!("{} {}",*a,*b);}', 'ax b\n'],
  ['let-else temporary lifetime extension', 'fn main(){let Some(ref a)=Some(1) else{return;};println!("{}",*a);}', '1\n'],
  ['match temporary stays alive within selected arm', 'fn main(){match Some(String::from("a")){Some(ref a)=>println!("{}",a.len()),None=>{}}}', '1\n'],
  ['while temporary is fresh per iteration', 'fn main(){let mut n=0;while let Some(ref mut p)=Some(1){*p+=1;n+=*p;if n==6{break;}}println!("{}",n);}', '6\n'],
  ['generic reference binding does not move abstract input', 'fn observe<T>(v:&T){}fn keep<T>(x:T)->T{let ref r=x;observe(r);x}fn main(){println!("{}",keep(String::from("kept")));}', 'kept\n'],
  ['closure reference pattern selects mutable capture', 'fn main(){let mut x=1;let mut f=||{let ref mut y=x;*y+=1;};f();f();println!("{}",x);}', '3\n'],
  ['closure shared pattern retains an Fn capture', 'fn main(){let x=String::from("a");let f=||{let ref y=x;y.len()};println!("{} {} {}",f(),f(),x);}', '1 1 a\n'],
  ['const function uses explicit shared and mutable pattern loans', 'const fn n()->i32{let mut x=40;let ref mut r=x;*r+=2;let ref s=x;*s}const N:i32=n();fn main(){println!("{}",N);}', '42\n'],
];
export const patternReferenceCompileFailCases = [
  ['mixed reference and owned move capture is still FnOnce', 'fn main(){let p=(String::from("a"),String::from("b"));let f=||{let(ref a,b)=p;println!("{} {}",a.len(),b);};f();f();}', 'E0382'],
  ['mutable pattern requires mutable storage','fn main(){let x=1;let ref mut r=x;*r=2;}', 'E0596'],
  ['shared pattern cannot write pointee','fn main(){let x=1;let ref r=x;*r=2;}', 'E0594'],
  ['mutable pattern handle itself is immutable','fn main(){let mut x=1;let mut y=2;let ref mut r=x;r=&mut y;}', 'E0596'],
  ['mutable pattern handles cannot be copied','fn main(){let mut x=1;let ref mut r=x;let s=r;println!("{} {}",*s,*r);}', 'E0382'],
  ['two live mutable pattern borrows conflict','fn main(){let mut x=1;let ref mut a=x;let ref mut b=x;println!("{} {}",*a,*b);}', 'E0502'],
  ['read of mutably pattern-borrowed source conflicts','fn main(){let mut x=1;let ref mut r=x;println!("{} {}",x,*r);}', 'E0503'],
  ['mutation of shared pattern-borrowed source conflicts','fn main(){let mut x=1;let ref r=x;x=2;println!("{}",*r);}', 'E0502'],
  ['shared and mutable pattern aliases conflict','fn main(){let mut x=1;let ref a=x;let ref mut b=x;println!("{} {}",*a,*b);}', 'E0502'],
  ['pattern borrow cannot read a moved field','fn main(){let p=(String::from("a"),2);let x=p.0;let(ref r,_)=p;println!("{}",r.len());}', 'E0382'],
  ['whole pattern borrow cannot span a moved sibling','fn main(){let p=(String::from("a"),2);let x=p.0;let ref r=p;println!("{}",r.1);}', 'E0382'],
  ['whole reference conflicts with a moved subpattern','fn main(){let p=(String::from("a"),String::from("b"));let ref w @ (x,_)=p;println!("{} {}",w.1,x);}', 'E0502'],
  ['mutable whole and shared subpattern conflict','fn main(){let mut p=(1,2);let ref mut w @ (ref x,_)=p;println!("{} {}",w.1,*x);}', 'E0503'],
  ['shared source cannot produce mutable pattern reborrow','fn main(){let p=(1,2);let r=&p;let(ref mut a,_)=*r;*a+=1;}', 'E0594'],
  ['pattern reference cannot escape a local function value','fn bad(x:&i32)->&i32{let y=1;let ref r=y;r}fn main(){let z=0;println!("{}",*bad(&z));}', 'E0515'],
  ['pattern reference cannot escape a local block','fn main(){let x=0;let mut out=&x;{let y=2;let ref r=y;out=r;}println!("{}",*out);}', 'E0597'],
  ['mutable candidate binding cannot write in its guard','fn main(){let mut p=Some(1);match p{Some(ref mut r) if {*r=2;true}=>{},_=>{}}}', 'E0594'],
  ['wildcard guard cannot replace inspected scalar scrutinee','fn main(){let mut p=1;match p{_ if {p=2;false}=>{},1=>{},ref r=>println!("{}",*r)}}', 'E0510'],
  ['wildcard guard cannot replace inspected tuple scrutinee','fn main(){let mut p=(1,2);match p{_ if {p=(3,4);false}=>{},(1,_)=>{},ref r=>println!("{}",r.0)}}', 'E0510'],
  ['reference-storage borrow respects a live pointee reborrow','fn main(){let mut x=1;let r=&mut x;let child=&mut*r;let ref holder=r;println!("{} {}",*child,**holder);}', 'E0503'],
  ['reference temporary retains inner caller loan','fn id(x:&i32)->&i32{x}fn main(){let mut x=1;let ref s=id(&x);x=2;println!("{}",**s);}', 'E0502'],
  ['reference binding cannot shadow a constant','const N:i32=1;fn main(){let ref N=2;}', 'E0530'],
  ['or-pattern binding mode must agree','fn main(){let p=(1,2);match p{(ref r,_)|(_,r)=>{}}}', 'E0409'],
  ['or-pattern shared and mutable modes must agree','fn main(){let mut p=(1,2);match p{(ref r,_)|(_,ref mut r)=>{}}}', 'E0409'],
];

// All 64 read/write/borrow combinations over nested projected locations. These
// source programs are independently checked by rustc, not inferred as an oracle.
const paths = ['p.0.0','p.0.1','p.1.0','p.1.1'];
for (const mutable of [false,true]) for (let borrowed=0;borrowed<4;borrowed++) for(let accessed=0;accessed<4;accessed++) for(const write of [false,true]) {
  const leaf = i => i===borrowed ? `ref ${mutable?'mut ':''}r` : '_';
  const pattern=`((${leaf(0)},${leaf(1)}),(${leaf(2)},${leaf(3)}))`;
  const source=`fn main(){let mut p=((1,2),(3,4));let ${pattern}=p;${write?`${paths[accessed]}+=10;`: `let seen=${paths[accessed]};` }println!("{}",*r);}`;
  const name=`nested pattern ${mutable?'mutable':'shared'} ${borrowed} versus ${write?'write':'read'} ${accessed}`;
  if(borrowed===accessed&&(mutable||write))patternReferenceCompileFailCases.push([name,source,write?'E0502':'E0503']);
  else patternReferenceCases.push([name,source,`${borrowed+1}\n`]);
}

export const patternReferenceGuide = "struct Packet {\n    name: String,\n    payload: String,\n    sequence: u32,\n}\n\nfn bump(packet: &mut Packet) -> &mut u32 {\n    let Packet {\n        ref mut sequence,\n        ..\n    } = *packet;\n    *sequence += 1;\n    sequence\n}\n\nfn main() {\n    let mut packet = Packet {\n        name: String::from(\"header\"),\n        payload: String::from(\"body\"),\n        sequence: 41,\n    };\n    {\n        let Packet {\n            ref name,\n            ref mut payload,\n            ..\n        } = packet;\n        payload.push_str(\"!\");\n        println!(\"{} {}\", *name, *payload);\n    }\n    println!(\"{}\", *bump(&mut packet));\n    let Packet {\n        name,\n        ref payload,\n        ..\n    } = packet;\n    println!(\"{} {}\", name, *payload);\n}\n";
patternReferenceCases.push(['complete pattern reference guide', patternReferenceGuide, 'header body!\n42\nheader body!\n']);
