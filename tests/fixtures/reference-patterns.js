// Shared exact sources: browser backends and the native edition-2024 oracle.
export const referencePatternCases = [
  [
    "string",
    "fn main(){let x=String::from(\"ok\");let ref r=x;println!(\"{} {}\",*r,x);}",
    "ok ok\n"
  ],
  [
    "nested",
    "fn main(){let mut p=((1,2),(3,4));let ((ref mut a,_),(_,ref mut b))=p;*a=10;*b=40;println!(\"{} {}\",p.0.0,p.1.1);}",
    "10 40\n"
  ],
  [
    "move sibling",
    "fn main(){let p=(String::from(\"a\"),String::from(\"b\"));let (a,ref b)=p;println!(\"{} {} {}\",a,*b,p.1);}",
    "a b b\n"
  ],
  [
    "mut whole copy",
    "fn main(){let mut p=(1,2);let ref mut all @ (x,_)=p;all.1+=10;println!(\"{} {}\",x,all.1);}",
    "1 12\n"
  ],
  [
    "shorthand",
    "struct P{a:i32,b:i32} fn main(){let mut p=P{a:1,b:2};let P{ref mut a,ref b}=p;*a+=*b;println!(\"{} {}\",p.a,p.b);}",
    "3 2\n"
  ],
  [
    "enum guard",
    "fn main(){let mut p=Some(40);match p{Some(ref mut x) if *x>0=>{*x+=2;},_=>{}}println!(\"{}\",p.unwrap());}",
    "42\n"
  ],
  [
    "guard false next",
    "fn main(){let mut p=Some(40);match p{Some(ref mut x) if *x==0=>{},Some(ref mut x)=>*x+=2,_=>{}}println!(\"{}\",p.unwrap());}",
    "42\n"
  ],
  [
    "array",
    "fn main(){let mut p=[1,2,3];let [ref mut x,_,ref mut y]=p;*x+=10;*y+=20;println!(\"{} {}\",p[0],p[2]);}",
    "11 23\n"
  ],
  [
    "ref shared pointer",
    "fn main(){let p=(1,2);let q=&p;let (ref a,ref b)=*q;println!(\"{} {}\",*a,*b);}",
    "1 2\n"
  ],
  [
    "ref mutable pointer",
    "fn main(){let mut p=(1,2);let q=&mut p;let (ref mut a,ref mut b)=*q;*a=3;*b=4;println!(\"{} {}\",p.0,p.1);}",
    "3 4\n"
  ],
  [
    "temp call",
    "fn f()->(i32,i32){(40,2)} fn main(){let (ref x,ref y)=f();println!(\"{}\",*x+*y);}",
    "42\n"
  ],
  [
    "return param",
    "fn f(p:&(i32,i32))->&i32{let (ref x,_)=*p;x}fn main(){let p=(42,2);println!(\"{}\",*f(&p));}",
    "42\n"
  ],
  [
    "refmut loop",
    "fn main(){let mut p=Some(0);while let Some(ref mut x)=p{*x+=1;if *x==3{break;}}println!(\"{}\",p.unwrap());}",
    "3\n"
  ],
  [
    "refmut chain",
    "fn main(){let mut p=Some(40);if let Some(ref mut x)=p && *x>0{*x+=2;}println!(\"{}\",p.unwrap());}",
    "42\n"
  ],
  [
    "or mut",
    "fn main(){let mut p=(0,40);match p{(0,ref mut x)|(ref mut x,0)=>*x+=2,_=>{}}println!(\"{}\",p.1);}",
    "42\n"
  ],
  [
    "or shared",
    "fn main(){let p=(0,40);match p{(0,ref x)|(ref x,0)=>println!(\"{}\",*x),_=>{}}}",
    "40\n"
  ],
  [
    "closure shared",
    "fn main(){let s=String::from(\"ok\");let c=||{let ref r=s;println!(\"{}\",*r);};c();c();println!(\"{}\",s);}",
    "ok\nok\nok\n"
  ],
  [
    "closure mut",
    "fn main(){let mut n=0;let mut c=||{let ref mut r=n;*r+=1;};c();c();println!(\"{}\",n);}",
    "2\n"
  ],
  [
    "letelse",
    "fn main(){let mut p=Some(40);let Some(ref mut r)=p else{return;};*r+=2;println!(\"{}\",p.unwrap());}",
    "42\n"
  ],
  [
    "side effect index",
    "fn idx(n:&mut i32)->usize{*n+=1;0}fn main(){let mut n=0;let mut a=[(40,2)];let (ref mut x,ref y)=a[idx(&mut n)];*x+=*y;println!(\"{} {}\",n,a[0].0);}",
    "1 42\n"
  ]
];

export const referencePatternCompileFailCases = [
  [
    "shared conflict",
    "fn main(){let mut x=1;let ref r=x;x=2;println!(\"{}\",*r);}",
    "E0502"
  ],
  [
    "exclusive read",
    "fn main(){let mut x=1;let ref mut r=x;println!(\"{} {}\",x,*r);}",
    "E0503"
  ],
  [
    "immutable",
    "fn main(){let x=1;let ref mut r=x;*r=2;}",
    "E0596"
  ],
  [
    "at double borrow",
    "fn main(){let mut p=(1,2);let ref mut all @ (ref mut a,_)=p;}",
    "E0499"
  ],
  [
    "at move borrow",
    "fn main(){let p=(String::from(\"a\"),);let ref all @ (a,)=p;}",
    "E0505"
  ],
  [
    "enum guard negative",
    "fn main(){let mut p=Some(40);match p{Some(ref mut x) if {*x+=1;true}=>{},_=>{}}}",
    "E0594"
  ],
  [
    "ref shared mutable reject",
    "fn main(){let p=(1,2);let q=&p;let (ref mut a,_)=*q;}",
    "E0594"
  ],
  [
    "temp escape",
    "fn f()->(i32,i32){(40,2)} fn main(){let r=match f(){(ref x,_)=>x};println!(\"{}\",*r);}",
    "E0597"
  ],
  [
    "return local",
    "fn f(p:&i32)->&i32{let n=42;let ref x=n;x}fn main(){let p=1;println!(\"{}\",*f(&p));}",
    "E0515"
  ],
  [
    "or mode mismatch",
    "fn main(){let p=(1,2);match p{(ref x,_)|(_,x)=>println!(\"{}\",x)}}",
    "E0308"
  ]
];

// Exhaustive 2 x 4 x 4 x 3 projected-loan/action matrix. Expected
// acceptance is decided by place overlap, mutability and action, not by Ferrite.
const paths = ['0.0', '0.1', '1.0', '1.1'];
for (const mutable of [false, true]) for (let borrowed = 0; borrowed < 4; borrowed++)
  for (let target = 0; target < 4; target++) for (const action of ['read', 'write', 'move']) {
    const cells = paths.map((_, i) => i === borrowed ? `ref ${mutable ? 'mut ' : ''}r` : '_');
    const pattern = `((${cells[0]},${cells[1]}),(${cells[2]},${cells[3]}))`;
    const values = action === 'move' ? paths.map((_, i) => `String::from("${'x'.repeat(i + 1)}")`) : ['1','2','3','4'];
    const value = `((${values[0]},${values[1]}),(${values[2]},${values[3]}))`;
    const effect = action === 'read' ? `println!("{} {}",p.${paths[target]},*r);` :
      action === 'write' ? `p.${paths[target]}=90;println!("{} {}",*r,p.${paths[target]});` :
      `let taken=p.${paths[target]};println!("{} {}",r.len(),taken.len());`;
    const source = `fn main(){let mut p=${value};let ${pattern}=p;${effect}}`;
    const name = `reference pattern matrix ${mutable ? 'exclusive' : 'shared'} ${paths[borrowed]} versus ${action} ${paths[target]}`;
    if (borrowed === target && (mutable || action !== 'read'))
      referencePatternCompileFailCases.push([name,source,action === 'read' ? 'E0503' : 'E0502']);
    else referencePatternCases.push([name,source,action === 'read' ? `${target+1} ${borrowed+1}\n` :
      action === 'write' ? `${borrowed+1} 90\n` : `${borrowed+1} ${target+1}\n`]);
  }

referencePatternCases.push(...[
  [
    "indirect shared storage",
    "fn main(){let mut n=1;let r=&n;let ref rr=r;println!(\"{}\",**rr);n=2;println!(\"{}\",n);}",
    "1\n2\n"
  ],
  [
    "parent handle released after shared storage last use",
    "fn main(){let mut n=1;let r=&mut n;let ref rr=r;println!(\"{}\",**rr);*r=2;println!(\"{}\",n);}",
    "1\n2\n"
  ],
  [
    "nested mutable enum payloads",
    "fn main(){let mut x=Some((1,2));if let Some((ref mut a,ref mut b))=x{*a+=10;*b+=20;}let Some((a,b))=x else{return;};println!(\"{} {}\",a,b);}",
    "11 22\n"
  ],
  [
    "mutable pattern returned through input contract",
    "fn f(p:&mut (i32,i32))->&mut i32{let (ref mut x,_)=*p;x}fn main(){let mut p=(40,2);*f(&mut p)+=2;println!(\"{}\",p.0);}",
    "42\n"
  ],
  [
    "pattern reborrow of computed reference",
    "fn f(p:&mut (i32,i32))->&mut (i32,i32){p}fn main(){let mut p=(40,2);let (ref mut a,ref b)=*f(&mut p);*a+=*b;println!(\"{}\",p.0);}",
    "42\n"
  ],
  [
    "enum record shorthand",
    "enum E{Data{a:i32,b:i32},Empty}fn main(){let mut e=E::Data{a:40,b:2};if let E::Data{ref mut a,ref b}=e{*a+=*b;}match e{E::Data{a,b}=>println!(\"{} {}\",a,b),_=>{}}}",
    "42 2\n"
  ],
  [
    "tuple struct",
    "struct P(i32,i32);fn main(){let mut p=P(40,2);let P(ref mut a,ref b)=p;*a+=*b;println!(\"{}\",p.0);}",
    "42\n"
  ],
  [
    "CTFE reference binding",
    "const fn f()->i32{let mut p=(40,2);let (ref mut a,ref b)=p;*a+=*b;p.0}const N:i32=f();fn main(){println!(\"{}\",N);}",
    "42\n"
  ],
  [
    "generic borrowed pointee",
    "fn f<T>(p:&T){let ref x=*p;let y=x;let z=x;}fn main(){let s=String::from(\"a\");f(&s);println!(\"ok\");}",
    "ok\n"
  ],
  [
    "generic mutable pointee",
    "fn f<T>(p:&mut T){let ref mut x=*p;let ref y=*x;}fn main(){let mut n=42;f(&mut n);println!(\"{}\",n);}",
    "42\n"
  ],
  [
    "branch result last use",
    "fn main(){let mut p=(1,2);let r=match p{(ref x,_)=>x};println!(\"{}\",*r);p.0=3;println!(\"{}\",p.0);}",
    "1\n3\n"
  ],
  [
    "while mutable pattern nested continue",
    "fn main(){let mut p=Some(0);while let Some(ref mut x)=p{*x+=1;if *x<3{continue;}break;}println!(\"{}\",p.unwrap());}",
    "3\n"
  ],
  [
    "temporary receiver scoped",
    "fn f()->(i32,i32){(40,2)}fn main(){if let (ref mut a,ref b)=f(){*a+=*b;println!(\"{}\",*a);}}",
    "42\n"
  ],
  [
    "by-value move and borrow across or variants",
    "enum E{A(String,String),B(String,String)}fn main(){let p=E::A(String::from(\"a\"),String::from(\"bb\"));match p{E::A(a,ref b)|E::B(a,ref b)=>println!(\"{} {}\",a.len(),b.len())}}",
    "1 2\n"
  ],
  [
    "shared @ nested ref",
    "fn main(){let p=(40,2);let ref a @ (ref b,ref c)=p;println!(\"{} {} {}\",a.0,*b,*c);}",
    "40 40 2\n"
  ],
  [
    "shadowed ref binding",
    "fn main(){let n=42;let ref n=n;let ref n=n;println!(\"{}\",**n);}",
    "42\n"
  ],
  [
    "borrow local temporary in static loop",
    "fn make()->Option<i32>{Some(42)}fn main(){while let Some(ref x)=make(){println!(\"{}\",*x);break;}}",
    "42\n"
  ],
  [
    "reference chain storage",
    "fn main(){let n=42;let r=&n;if let ref rr=r && **rr==42{println!(\"{}\",**rr);}}",
    "42\n"
  ]
]);

referencePatternCompileFailCases.push(...[
  [
    "indirect live storage",
    "fn main(){let mut n=1;let r=&n;let ref rr=r;n=2;println!(\"{}\",**rr);}",
    "E0502"
  ],
  [
    "mutable handle cannot move out of shared storage",
    "fn main(){let mut n=1;let r=&mut n;let ref rr=r;let copy=*rr;*copy=2;}",
    "E0507"
  ],
  [
    "returned caller whole-place loan",
    "fn f(p:&mut (i32,i32))->&mut i32{let (ref mut x,_)=*p;x}fn main(){let mut p=(40,2);let r=f(&mut p);p.1=3;println!(\"{}\",*r);}",
    "E0502"
  ],
  [
    "abstract pointee cannot gain Copy",
    "fn f<T>(p:&T)->T{let ref x=*p;*x}fn main(){let n=42;println!(\"{}\",f(&n));}",
    "E0507"
  ],
  [
    "ref binding cannot shadow constant",
    "const N:i32=1;fn main(){let ref N=2;}",
    "E0530"
  ],
  [
    "mutable ref binding cannot be reassigned",
    "fn main(){let mut n=1;let mut m=2;let ref mut x=n;x=&mut m;println!(\"{}\",*x);}",
    "E0596"
  ],
  [
    "outer mut modifier is invalid",
    "fn main(){let mut ref x=1;}",
    "E0003"
  ],
  [
    "mutable guard call",
    "fn touch(x:&mut i32){*x+=1;}fn main(){let mut p=Some(1);match p{Some(ref mut x) if {touch(x);true}=>{},_=>{}}}",
    "E0594"
  ],
  [
    "guard reference escape conflict",
    "fn main(){let mut p=Some(1);match p{Some(ref mut x) if {let r=x;*r+=1;true}=>{},_=>{}}}",
    "E0507"
  ],
  [
    "branch result retained",
    "fn main(){let mut p=(1,2);let r=match p{(ref x,_)=>x};p.0=3;println!(\"{}\",*r);}",
    "E0502"
  ],
  [
    "while shared pattern prevents mutation",
    "fn main(){let mut p=Some(0);while let Some(ref x)=p{p=None;println!(\"{}\",*x);}}",
    "E0502"
  ],
  [
    "temporary block escape",
    "fn f()->(i32,i32){(40,2)}fn main(){let r={let (ref x,_)=f();x};println!(\"{}\",*r);}",
    "E0597"
  ]
]);

// A shared edge anywhere in a reference-storage chain blocks mutation and
// exclusive reborrowing. All-exclusive paths must remain usable.
for (let depth = 1; depth <= 3; depth++) for (let mask = 0; mask < 1 << depth; mask++)
  for (const action of ['write', 'reborrow']) {
    let source = 'fn main(){let mut n=1;let mut p0=&mut n;';
    for (let i = 1; i <= depth; i++) source += `let mut p${i}=&${mask & 1 << (i-1) ? 'mut ' : ''}p${i-1};`;
    const target = '*'.repeat(depth+1) + 'p' + depth;
    source += (action === 'write' ? `${target}=9;` : `let q=&mut ${target};*q=9;`) + 'println!("{}",n);}';
    const name = `shared-storage chain depth ${depth} mask ${mask} ${action}`;
    if (mask === (1 << depth) - 1) referencePatternCases.push([name, source, '9\n']);
    else referencePatternCompileFailCases.push([name, source, 'E0594']);
  }
referencePatternCompileFailCases.push(
  ['shared ref pattern cannot grant mutable pointee access', 'fn main(){let mut n=1;let r=&mut n;let ref rr=r;**rr=2;}', 'E0594'],
  ['shared ref pattern cannot grant mutable pointee reborrow', 'fn main(){let mut n=1;let r=&mut n;let ref rr=r;let q=&mut **rr;*q=2;}', 'E0594'],
);

export const referencePatternGuide = "struct Packet {\n    name: String,\n    count: i32,\n}\n\nfn main() {\n    let mut packet = Packet {\n        name: String::from(\"packet\"),\n        count: 40,\n    };\n    let Packet {\n        ref name,\n        ref mut count,\n    } = packet;\n    *count += 2;\n    println!(\"{} {}\", *name, *count);\n\n    let mut result = Some((1, 2));\n    if let Some((ref mut left, ref right)) = result {\n        *left += *right;\n    }\n    let Some((left, right)) = result else {\n        return;\n    };\n    println!(\"{} {}\", left, right);\n}\n";
referencePatternCases.push(["reference pattern executable guide",referencePatternGuide,"packet 42\n3 2\n"]);
