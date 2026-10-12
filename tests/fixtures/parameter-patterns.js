import {readFileSync} from 'node:fs';
// These exact programs are also compiled by the native differential runner.
export const parameterPatternCases = [
  ['parameter tuple values', 'fn f((a,b):(i32,i32))->i32{a+b}fn main(){println!("{}",f((40,2)));}', '42\n'],
  ['parameter former reference-match boundary', 'fn f(&(x,):&(i32,))->i32{x}fn main(){let p=(42,);println!("{}",f(&p));}', '42\n'],
  ['parameter wildcard arguments', 'fn f(_:i32,_:i32)->i32{42}fn main(){println!("{}",f(1,2));}', '42\n'],
  ['parameter wildcard still evaluates argument once', 'fn effect(x:&mut i32)->i32{*x+=1;*x}fn f(_:i32){}fn main(){let mut x=41;f(effect(&mut x));println!("{}",x);}', '42\n'],
  ['parameter by-value ownership', 'fn f((a,b):(Vec<i32>,Vec<i32>))->usize{a.len()+b.len()}fn main(){println!("{}",f((vec![1,2],vec![3])));}', '3\n'],
  ['parameter by-reference owned storage', 'fn f(ref x:Vec<i32>)->usize{x.len()}fn main(){println!("{}",f(vec![1,2]));}', '2\n'],
  ['parameter ref-mut owned storage', 'fn f(ref mut x:i32)->i32{*x+=2;*x}fn main(){println!("{}",f(40));}', '42\n'],
  ['parameter ref-mut vector storage', 'fn f(ref mut v:Vec<i32>)->usize{v.push(3);v.len()}fn main(){println!("{}",f(vec![1,2]));}', '3\n'],
  ['parameter reference mutability does not mutate copied value', 'fn f(&mut mut x:&mut i32){x+=2;println!("{}",x);}fn main(){let mut x=40;f(&mut x);println!("{}",x);}', '42\n40\n'],
  ['parameter nested shared reference prefixes', 'fn f(&&(a,b):&&(i32,i32))->i32{a+b}fn main(){let p=(40,2);let r=&p;println!("{}",f(&r));}', '42\n'],
  ['parameter implicit shared bindings', 'fn f((a,b):&(i32,i32))->i32{*a+*b}fn main(){let p=(40,2);println!("{}",f(&p));}', '42\n'],
  ['parameter implicit mutable siblings', 'fn f((a,b):&mut(i32,i32)){*a+=*b;}fn main(){let mut p=(40,2);f(&mut p);println!("{}",p.0);}', '42\n'],
  ['parameter shared returned reference', 'fn f((a,_):&(i32,i32))->&i32{a}fn main(){let p=(42,1);println!("{}",*f(&p));}', '42\n'],
  ['parameter mutable returned reference', 'fn f((a,_):&mut(i32,i32))->&mut i32{a}fn main(){let mut p=(40,2);*f(&mut p)+=2;println!("{}",p.0);}', '42\n'],
  ['parameter returned loan expiry', 'fn f((a,_):&mut(i32,i32))->&mut i32{a}fn main(){let mut p=(40,2);let r=f(&mut p);*r+=2;p.1=3;println!("{} {}",p.0,p.1);}', '42 3\n'],
  ['parameter selected source argument after destructured prefix', 'fn f((a,b):(i32,i32),r:&i32)->&i32{let sum=a+b;r}fn main(){let n=42;println!("{}",*f((1,2),&n));}', '42\n'],
  ['parameter source argument before destructured suffix', 'fn f(r:&i32,(a,b):(i32,i32))->&i32{let sum=a+b;r}fn main(){let n=42;println!("{}",*f(&n,(1,2)));}', '42\n'],
  ['parameter named and destructured ABI slots', 'fn f((a,b):(i32,i32),c:i32,(d,e):(i32,i32))->i32{a+b+c+d+e}fn main(){println!("{}",f((1,2),3,(4,32)));}', '42\n'],
  ['parameter record value', 'struct P{a:i32,b:i32}fn f(P{a,b}:P)->i32{a+b}fn main(){println!("{}",f(P{a:40,b:2}));}', '42\n'],
  ['parameter nested record reference', 'struct P{a:(i32,i32),b:i32}fn f(P{a:(x,y),..}:&mut P){*x+=*y;}fn main(){let mut p=P{a:(40,2),b:3};f(&mut p);println!("{}",p.a.0);}', '42\n'],
  ['parameter tuple struct', 'struct P(i32,i32);fn f(P(a,b):P)->i32{a+b}fn main(){println!("{}",f(P(40,2)));}', '42\n'],
  ['parameter single-variant enum', 'enum E{P(i32,i32)}fn f(E::P(a,b):E)->i32{a+b}fn main(){println!("{}",f(E::P(40,2)));}', '42\n'],
  ['parameter single-variant enum reference', 'enum E{P(i32,i32)}fn f(E::P(a,b):&mut E){*a+=*b;}fn main(){let mut e=E::P(40,2);f(&mut e);let E::P(a,_)=e;println!("{}",a);}', '42\n'],
  ['parameter fixed array', 'fn f([a,b]:[i32;2])->i32{a+b}fn main(){println!("{}",f([40,2]));}', '42\n'],
  ['parameter array rest', 'fn f([a,middle @ ..,b]:[i32;4])->i32{a+middle[0]+middle[1]+b}fn main(){println!("{}",f([30,5,5,2]));}', '42\n'],
  ['parameter tuple rest', 'fn f((a,..,b):(i32,i32,i32))->i32{a+b}fn main(){println!("{}",f((40,99,2)));}', '42\n'],
  ['parameter reference array siblings', 'fn f([a,b]:&mut[i32;2]){*a+=*b;}fn main(){let mut p=[40,2];f(&mut p);println!("{}",p[0]);}', '42\n'],
  ['parameter unit and full boolean coverage', 'fn f(():(),(true|false):bool)->i32{42}fn main(){println!("{}",f((),true));}', '42\n'],
  ['parameter exhaustive range', 'fn f(0u8..=255u8:u8)->i32{42}fn main(){println!("{}",f(3));}', '42\n'],
  ['parameter at-copy', 'fn f(all @ (a,_):(i32,i32))->i32{all.1+a}fn main(){println!("{}",f((40,2)));}', '42\n'],
  ['parameter at-shared', 'fn f(ref all @ (ref a,ref b):(i32,i32))->i32{all.0+*a+*b}fn main(){println!("{}",f((20,2)));}', '42\n'],
  ['parameter parenthesized alternatives', 'fn f((x @ true|x @ false):bool)->bool{x}fn main(){println!("{}",f(true));}', 'true\n'],
  ['parameter generic bound copying', 'fn f<T:Copy>((a,_):(T,T))->(T,T){(a,a)}fn main(){let p=f((42,3));println!("{} {}",p.0,p.1);}', '42 42\n'],
  ['parameter generic reference without Copy', 'fn f<T>((a,_):&(T,T))->&T{a}fn main(){let p=(vec![1,2],vec![3]);println!("{}",f(&p).len());}', '2\n'],
  ['parameter generic mutable reference without Copy', 'fn f<T>((a,_):&mut(T,T))->&mut T{a}fn main(){let mut p=(vec![1],vec![3]);f(&mut p).push(2);println!("{}",p.0.len());}', '2\n'],
  ['parameter generic record alias', 'struct P<T>{a:T,b:T}type Pair<T>=P<T>;fn f<T>(Pair{a,..}:&Pair<T>)->&T{a}fn main(){let p=P{a:42,b:1};println!("{}",*f(&p));}', '42\n'],
  ['parameter associated equality structure', 'trait S{type Item;}struct A;impl S for A{type Item=(i32,i32);}fn f<T:S<Item=(i32,i32)>>((a,b):T::Item)->i32{a+b}fn main(){println!("{}",f::<A>((40,2)));}', '42\n'],
  ['parameter constant evaluation', 'const fn f((a,b):(i32,i32))->i32{a+b}const N:i32=f((40,2));fn main(){println!("{}",N);}', '42\n'],
  ['parameter recursive calls', 'fn f((n,total):(i32,i32))->i32{if n==0{total}else{f((n-1,total+n))}}fn main(){println!("{}",f((3,36)));}', '42\n'],
  ['parameter method and receiver layout', 'struct S(i32);impl S{fn f(&self,(a,b):(i32,i32))->i32{self.0+a+b}}fn main(){println!("{}",S(30).f((10,2)));}', '42\n'],
  ['parameter trait implementation', 'trait T{fn f(&self,p:(i32,i32))->i32;}struct S;impl T for S{fn f(&self,(a,b):(i32,i32))->i32{a+b}}fn main(){println!("{}",S.f((40,2)));}', '42\n'],
  ['parameter trait default body', 'trait T{fn f((a,b):(i32,i32))->i32{a+b}}struct S;impl T for S{}fn main(){println!("{}",S::f((40,2)));}', '42\n'],
  ['parameter module resolution', 'mod m{pub struct P(pub i32,pub i32);pub fn f(P(a,b):P)->i32{a+b}}fn main(){println!("{}",m::f(m::P(40,2)));}', '42\n'],
  ['parameter checked function pointer', 'fn f((a,b):(i32,i32))->i32{a+b}fn main(){let p:fn((i32,i32))->i32=f;println!("{}",p((40,2)));}', '42\n'],
  ['parameter reference function pointer', 'fn f((a,_):&(i32,i32))->&i32{a}fn main(){let p:fn(&(i32,i32))->&i32=f;let x=(42,1);println!("{}",*p(&x));}', '42\n'],
  ['parameter early return', 'fn f((a,b):(i32,i32))->i32{if a>0{return a+b;}0}fn main(){println!("{}",f((40,2)));}', '42\n'],
  ['parameter nested scope shadow', 'fn f((a,b):(i32,i32))->i32{{let a=1;println!("{}",a);}a+b}fn main(){println!("{}",f((40,2)));}', '1\n42\n'],
  ['closure parameter tuple', 'fn main(){let c=|(a,b):(i32,i32)|a+b;println!("{}",c((40,2)));}', '42\n'],
  ['closure parameter inferred tuple', 'fn main(){let c=|(a,b)|a+b;println!("{}",c((40,2)));}', '42\n'],
  ['closure parameter borrowed owned storage', 'fn main(){let c=|ref mut x:i32|{*x+=2;*x};println!("{} {}",c(40),c(1));}', '42 3\n'],
  ['closure parameter borrowed repeated calls', 'fn main(){let c=|(a,_):&mut(i32,i32)|{*a+=1;};let mut p=(40,2);let r=&mut p;c(r);c(r);println!("{}",p.0);}', '42\n'],
  ['closure parameter shadow prevents capture', 'fn main(){let a=String::from("outer");let c=|(a,b):(i32,i32)|a+b;println!("{} {}",c((40,2)),a);}', '42 outer\n'],
  ['closure parameter nested shadow prevents capture', 'fn main(){let a=String::from("outer");let c=||{let d=|(a,b):(i32,i32)|a+b;d((40,2))};println!("{} {}",c(),a);}', '42 outer\n'],
  ['closure parameter keeps genuine capture', 'fn main(){let n=2;let c=|(a,_):(i32,i32)|a+n;println!("{}",c((40,99)));}', '42\n'],
  ['closure parameter FnMut capture', 'fn main(){let mut n=0;let mut c=|(a,b):(i32,i32)|{n+=a+b;};c((30,2));c((8,2));println!("{}",n);}', '42\n'],
  ['closure parameter FnOnce capture', 'fn main(){let v=vec![1,2];let c=|(a,b):(i32,i32)|{let moved=v;a+b};println!("{}",c((40,2)));}', '42\n'],
  ['closure parameter generic annotation preserves bound', 'fn f<T:Copy>(p:(T,T)){let c=|(a,_):(T,T)|{let x=a;let y=a;};c(p);}fn main(){f((1,2));println!("ok");}', 'ok\n'],
  ['closure parameter generic direct inference', 'fn f<T:Copy>(p:(T,T)){let c=|(a,_)|{let x=a;let y=a;};c(p);}fn main(){f((1,2));println!("ok");}', 'ok\n'],
  ['closure parameter callable bound context', 'fn apply<F:Fn((i32,i32))->i32>(f:F)->i32{f((40,2))}fn main(){println!("{}",apply(|(a,b)|a+b));}', '42\n'],
  ['closure parameter function pointer context', 'fn main(){let c:fn((i32,i32))->i32=|(a,b)|a+b;println!("{}",c((40,2)));}', '42\n'],
];

export const parameterPatternCompileFailCases = [
  ['parameter duplicate simple names','fn f(a:i32,a:i32){}fn main(){f(1,2);}','E0415'],
  ['parameter duplicate nested names','fn f((a,a):(i32,i32)){}fn main(){f((1,2));}','E0415'],
  ['parameter duplicate across ABI slots','fn f((a,b):(i32,i32),a:i32){}fn main(){f((1,2),3);}','E0415'],
  ['parameter missing constructor case','fn f(Some(x):Option<i32>){}fn main(){f(Some(1));}','E0005'],
  ['parameter refutable reference','fn f(&0:&i32){}fn main(){let x=0;f(&x);}','E0005'],
  ['parameter nonexhaustive range','fn f(0u8..=10u8:u8){}fn main(){f(1);}','E0005'],
  ['parameter const path is not a binding','const X:i32=1;fn f(X:i32){}fn main(){}','E0005'],
  ['parameter cannot shadow const with mut','const X:i32=1;fn f(mut X:i32){}fn main(){}','E0530'],
  ['parameter cannot shadow const with ref','const X:i32=1;fn f(ref X:i32){}fn main(){}','E0530'],
  ['parameter cannot move through shared reference','fn f(&(v,):&(Vec<i32>,)){}fn main(){let p=(vec![1],);f(&p);}','E0507'],
  ['parameter cannot move through mutable reference','fn f(&mut(v,):&mut(Vec<i32>,)){}fn main(){let mut p=(vec![1],);f(&mut p);}','E0507'],
  ['parameter mutable handle is not Copy','fn f((r,_):&mut(i32,i32)){let a=r;let b=r;}fn main(){let mut p=(1,2);f(&mut p);}','E0382'],
  ['parameter overlapping reference binders','fn f(ref mut all @ (ref a,_):(i32,i32)){}fn main(){f((1,2));}','E0499'],
  ['parameter borrow and owned move overlap','fn f(ref all @ (v,_):(Vec<i32>,i32)){}fn main(){f((vec![1],2));}','E0505'],
  ['parameter shared loan cannot mutate','fn f((r,_):&(i32,i32)){*r=1;}fn main(){let p=(1,2);f(&p);}','E0594'],
  ['parameter ref mut through shared prefix','fn f(&(ref mut r,_):&(i32,i32)){}fn main(){let p=(1,2);f(&p);}','E0596'],
  ['parameter 2024 explicit ref below implicit prefix','fn f((ref a,_):&(i32,i32)){}fn main(){let p=(1,2);f(&p);}','E0003'],
  ['parameter return local argument address','fn f<T>(ref p:T,other:&T)->&T{p}fn main(){let x=42;let r=f(1,&x);println!("{}",*r);}','E0515'],
  ['parameter caller cannot mutate retained whole argument','fn f((a,_):&mut(i32,i32))->&mut i32{a}fn main(){let mut p=(40,2);let r=f(&mut p);p.1=3;println!("{}",*r);}','E0502'],
  ['parameter cannot outlive caller block','fn f((a,_):&(i32,i32))->&i32{a}fn main(){let r={let p=(40,2);f(&p)};println!("{}",*r);}','E0597'],
  ['parameter generic tuple shape cannot be invented','fn f<T>((a,b):T)->i32{a+b}fn main(){println!("{}",f((1,2)));}','E0308'],
  ['parameter generic record shape cannot be invented','struct P(i32);fn f<T>(P(a):T)->i32{a}fn main(){println!("{}",f(P(1)));}','E0308'],
  ['parameter generic array shape cannot be invented','fn f<T>([a,b]:T)->i32{a+b}fn main(){println!("{}",f([1,2]));}','E0308'],
  ['parameter generic reference shape cannot be invented','fn f<T>(&x:T)->i32{x}fn main(){let x=1;println!("{}",f(&x));}','E0308'],
  ['parameter generic copying requires declaration bound','fn f<T>((a,b):(T,T))->(T,T){(a,a)}fn main(){f((1,2));}','E0382'],
  ['closure annotated parameter generic shape','fn f<T>(t:T){let c=|&x:T|{println!("{}",x);};c(t);}fn main(){let x=1;f(&x);}','E0308'],
  ['closure inferred parameter generic shape','fn f<T>(t:T){let c=|&x|{println!("{}",x);};c(t);}fn main(){let x=1;f(&x);}','E0308'],
  ['closure annotated parameter generic copying','fn f<T>(t:(T,T)){let c=|(a,_):(T,T)|{let x=a;let y=a;};c(t);}fn main(){f((1,2));}','E0382'],
  ['closure inferred parameter generic copying','fn f<T>(t:(T,T)){let c=|(a,_)|{let x=a;let y=a;};c(t);}fn main(){f((1,2));}','E0382'],
  ['closure parameter refutable','fn main(){let c=|Some(x):Option<i32>|x;c(Some(1));}','E0005'],
  ['closure parameter duplicate','fn main(){let c=|(a,b):(i32,i32),a:i32|a;c((1,2),3);}','E0415'],
  ['parameter patterns in declaration without body','trait T{fn f((a,b):(i32,i32));}fn main(){}','E0642'],
  ['parameter ref in declaration without body','trait T{fn f(ref a:i32);}fn main(){}','E0642'],
  ['parameter mut in declaration without body','trait T{fn f(mut a:i32);}fn main(){}','E0642'],
  ['parameter self outside associated function','fn f(self:i32){}fn main(){}','E0424'],
  ['parameter nested self forbidden','fn f((self,_):(i32,i32)){}fn main(){}','E0424'],
  ['parameter top-level alternative requires parentheses','fn f(true|false:bool){}fn main(){}','E0003'],
];

export const parameterPatternCapabilityCases = [
  ['parameter mutable reference-storage binding','fn f(ref mut r:&mut i32){**r+=1;}fn main(){let mut x=1;f(&mut x);}','F_PATTERN_BORROW'],
  ['parameter by-value aggregate reference extraction','fn f((r,):(&i32,))->i32{*r}fn main(){let x=42;println!("{}",f((&x,)));}','F_PATTERN_REFERENCE'],
  ['parameter borrowed array rest','fn f([ref head,ref rest @ ..]:[i32;3])->i32{*head+rest[0]}fn main(){f([1,2,3]);}','F_PATTERN_BORROW'],
  ['closure returned reference contract','fn main(){let c:fn(&(i32,i32))->&i32=|(r,_):&(i32,i32)|r;let p=(1,2);c(&p);}','F_BORROW_CONTRACT'],
];

parameterPatternCases.push(
  ["closure typed reference prefix", "fn main(){let c=|&(a,b):&(i32,i32)|a+b;let p=(40,2);println!(\"{}\",c(&p));}", "42\n"],
  ["parameter split mutable body loans", "fn f((a,b):&mut(i32,i32)){let r=&*a;*b+=*r;println!(\"{} {}\",*r,*b);}fn main(){let mut p=(40,2);f(&mut p);}", "40 42\n"],
  ["parameter computed vector receiver evaluated once", "fn f((v,_):&mut(Vec<i32>,i32))->&mut Vec<i32>{print!(\"f\");v}fn item()->i32{print!(\"i\");2}fn main(){let mut p=(vec![1],0);f(&mut p).push(item());println!(\" {}\",p.0.len());}", "fi 2\n"],
  ["parameter computed string receiver", "fn f((s,_):&mut(String,i32))->&mut String{s}fn main(){let mut p=(String::from(\"a\"),0);f(&mut p).push_str(\"b\");println!(\"{}\",p.0);}", "ab\n"],
  ["parameter repeated calls preserve source handle", "fn f((r,_):&mut(i32,i32)){*r+=1;}fn main(){let mut p=(40,2);let r=&mut p;f(r);f(r);println!(\"{}\",p.0);}", "42\n"],
  ["parameter shadowed mutable reference expires by liveness", "fn f((r,_):&mut(i32,i32)){*r+=1;let r=1;println!(\"{}\",r);}fn main(){let mut p=(41,2);f(&mut p);println!(\"{}\",p.0);}", "1\n42\n"],
  ["parameter nonmoving wildcard through borrowed owned aggregate", "fn f(&(_,ref b):&(Vec<i32>,i32))->i32{*b}fn main(){let p=(vec![1],42);println!(\"{} {}\",f(&p),p.0.len());}", "42 1\n"],
  ["parameter plain mutable reference wildcard consumes handle", "fn f(_: &mut i32){}fn main(){let mut x=42;let r=&mut x;f(r);f(r);println!(\"{}\",x);}", "42\n"],
  ["parameter unicode bindings", "fn f((liczba,żółw):(i32,i32))->i32{liczba+żółw}fn main(){println!(\"{}\",f((40,2)));}", "42\n"],
  ["parameter raw identifier binding", "fn f((r#type,b):(i32,i32))->i32{r#type+b}fn main(){println!(\"{}\",f((40,2)));}", "42\n"]
);

parameterPatternCompileFailCases.push(
  ["closure late reference argument cannot add implicit matching", "fn main(){let f=|(a,b)|{*a+=*b;};let mut p=(40,2);f(&mut p);}", "E0308"],
  ["closure unannotated wildcard moves mutable input", "fn main(){let c=|_|();let mut x=0;let r=&mut x;c(r);c(r);}", "E0382"],
  ["closure unannotated named input moves mutable handle", "fn main(){let c=|r|{let _=r;};let mut x=0;let r=&mut x;c(r);c(r);}", "E0382"],
  ["parameter return borrowed owned field", "fn f((ref a,_):(i32,i32),r:&i32)->&i32{a}fn main(){let n=0;println!(\"{}\",*f((42,2),&n));}", "E0515"],
  ["parameter local mutation overlaps input child loan", "fn f((a,_):&mut(i32,i32)){let r=&*a;*a=3;println!(\"{}\",*r);}fn main(){let mut p=(1,2);f(&mut p);}", "E0502"],
  ["parameter computed receiver cannot alias argument", "fn f((v,_):&mut(Vec<i32>,i32))->&mut Vec<i32>{v}fn main(){let mut p=(vec![1],0);f(&mut p).push(p.0[0]);}", "E0503"],
  ["closure parameter abstract annotation does not acquire reborrow", "fn outer<T>(x:T){let c=|r:T|{let _=r;};c(x);c(x);}fn main(){let mut x=0;outer(&mut x);}", "E0382"]
);

parameterPatternCapabilityCases.push(
  ["closure generic callable context requires symbolic argument origin", "fn apply<T,F:Fn(T)>(t:T,f:F){f(t)}fn outer<T>(t:T){apply((t,1),|(_,_)|());}fn main(){outer(2);}", "F_PARAMETER_ORIGIN"]
);

// Signature-level caller-loan matrix: choosing a field in a parameter pattern
// must not narrow the declared whole-argument lifetime in the caller. Explicit
// projected actual arguments retain their own disjoint outer-branch precision.
for (const branch of [0,1]) for (const leaf of [0,1])
  for (const targetBranch of [0,1]) for (const targetLeaf of [0,1])
    for (const mutable of [false,true]) for (const write of [false,true]) {
      const pattern=leaf===0?'(selected,_)':'(_,selected)', reference=mutable?'&mut ':'&';
      const target=`p.${targetBranch}.${targetLeaf}`,value=10+2*branch+leaf,read=10+2*targetBranch+targetLeaf;
      const access=write?`${target}+=100;`:`println!("{}",${target});`;
      const source=`fn select(${pattern}:${reference}(i32,i32))->${reference}i32{selected}fn main(){let mut p=((10,11),(12,13));let r=select(${reference}p.${branch});${access}println!("{}",*r);}`;
      const name=`parameter caller matrix ${branch}.${leaf} to ${targetBranch}.${targetLeaf} ${mutable?'exclusive':'shared'} ${write?'write':'read'}`;
      if(branch===targetBranch&&(mutable||write)) parameterPatternCompileFailCases.push([name,source,write?'E0502':'E0503']);
      else parameterPatternCases.push([name,source,write?`${value}\n`:`${read}\n${value}\n`]);
    }

export const parameterPatternGuide=readFileSync(new URL('../../examples/14-parameter-patterns.rs',import.meta.url),'utf8');
parameterPatternCases.push(['parameter pattern executable guide',parameterPatternGuide,'42 44\n']);

parameterPatternCapabilityCases.push(
  ['closure inferred shared prefix needs input regions','fn main(){let c=|&(a,b)|a+b;let p=(40,2);println!("{}",c(&p));}','F_CLOSURE_INPUT_REGION'],
  ['closure inferred mutable prefix needs input regions','fn main(){let c=|&mut n|n;let mut n=42;println!("{}",c(&mut n));}','F_CLOSURE_INPUT_REGION'],
  ['closure contextual reference pattern needs an explicit region origin','fn main(){let c:fn(&(i32,i32))->i32=|(a,b)|*a+*b;let p=(40,2);println!("{}",c(&p));}','F_CLOSURE_INPUT_REGION']
);
// Native rejects these programs. Ferrite refuses their unrepresented inferred
// input-region contract before ordinary loan checking; do not misclassify them
// as native-valid capabilities or count F_* diagnostics in the E_* corpus.
export const parameterPatternRegionSafetyCases = [
  ['closure inferred mutable prefix repeated actual borrow','fn main(){let c=|&mut _|();let mut x=0;c(&mut x);c(&mut x);}','F_CLOSURE_INPUT_REGION'],
  ['closure inferred mutable prefix repeated handle','fn main(){let c=|&mut _|();let mut x=0;let r=&mut x;c(r);c(r);}','F_CLOSURE_INPUT_REGION'],
  ['closure inferred shared prefix outlives input','fn main(){let c=|&_|();{let x=0;c(&x);}let y=1;c(&y);}','F_CLOSURE_INPUT_REGION'],
  ['closure inferred shared tuple prefix outlives input','fn main(){let c=|&(a,b)|a+b;{let p=(1,2);c(&p);}let q=(3,4);c(&q);}','F_CLOSURE_INPUT_REGION'],
  ['closure inferred wildcard tuple cannot erase fixed regions','fn main(){let c=|(_,_)|();{let x=0;c((&x,1));}let y=1;c((&y,1));}','F_CLOSURE_INPUT_REGION'],
  ['closure inferred ref binder outlives input','fn main(){let c=|ref r|();{let x=0;c(&x);}let y=1;c(&y);}','F_CLOSURE_INPUT_REGION']
];
parameterPatternCases.push(
  ['closure typed mutable prefix repeated actual borrow','fn main(){let c=|&mut _: &mut i32|();let mut x=42;c(&mut x);c(&mut x);println!("{}",x);}','42\n'],
  ['closure typed shared prefix has fresh call lifetimes','fn main(){let c=|&(a,b):&(i32,i32)|a+b;{let p=(1,2);println!("{}",c(&p));}let q=(40,2);println!("{}",c(&q));}','3\n42\n']
);

parameterPatternCases.push(
  ['parameter grouped scalar binding','fn f((x):i32)->i32{x}fn main(){println!("{}",f(42));}','42\n'],
  ['parameter grouped mutable binding','fn f((mut x):i32)->i32{x+=2;x}fn main(){println!("{}",f(40));}','42\n'],
  ['parameter grouped wildcard binding','fn f((_):i32){}fn main(){f(1);println!("ok");}','ok\n'],
  ['parameter unit constructor is not a binding','struct S;fn f(S:S)->i32{42}fn main(){println!("{}",f(S));}','42\n'],
  ['parameter required wildcard name','trait T{fn f(_:i32)->i32;}struct S;impl T for S{fn f((x):i32)->i32{x}}fn main(){println!("{}",S::f(42));}','42\n'],
  ['closure grouped scalar binding','fn main(){let c=|(x):i32|x+2;println!("{}",c(40));}','42\n'],
  ['parameter const local ref binding','const fn f(ref mut x:i32)->i32{*x+=2;*x}const N:i32=f(40);fn main(){println!("{}",N);}','42\n'],
  ['closure parameter environment-name collision','fn main(){let n=2;let c=|(__environment,_):(i32,i32)|__environment+n;println!("{}",c((40,0)));}','42\n']
);
parameterPatternCompileFailCases.push(
  ['parameter grouped name in required declaration','trait T{fn f((x):i32);}fn main(){}','E0642'],
  ['parameter grouped wildcard in required declaration','trait T{fn f((_):i32);}fn main(){}','E0642'],
  ['parameter grouped self is not receiver syntax','struct S;impl S{fn f((self):Self){}}fn main(){S::f(S);}','E0424']
);
