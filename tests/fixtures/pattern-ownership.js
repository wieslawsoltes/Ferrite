const main = body => `fn main(){${body}}`;
export const patternOwnershipCases = [
  ['tuple independent owned bindings', main('let p=(String::from("left"),String::from("right"));let (a,_)=p;let (_,b)=p;println!("{} {}",a,b);'), 'left right\n'],
  ['tuple Copy sibling after destructuring', main('let p=(String::from("a"),42);let (a,_)=p;println!("{} {}",a,p.1);'), 'a 42\n'],
  ['nested tuple fields', main('let p=((String::from("a"),String::from("b")),String::from("c"));let ((a,_),_)=p;let ((_,b),c)=p;println!("{} {} {}",a,b,c);'), 'a b c\n'],
  ['record siblings', 'struct P{left:String,right:String}'+main('let p=P{left:String::from("a"),right:String::from("b")};let P{left:a,..}=p;let P{right:b,..}=p;println!("{} {}",a,b);'), 'a b\n'],
  ['tuple struct siblings', 'struct P(String,String);'+main('let p=P(String::from("a"),String::from("b"));let P(a,..)=p;let P(_,b)=p;println!("{} {}",a,b);'), 'a b\n'],
  ['wildcard after whole move', main('let p=String::from("a");let a=p;let _=p;println!("{}",a);'), 'a\n'],
  ['nested wildcards after whole move', main('let p=((String::from("a"),),);let a=p;let ((_,),)=p;println!("{}",a.0.0);'), 'a\n'],
  ['wildcards under active disjoint mutable loan', main('let mut p=(1,42);let r=&mut p.0;let (_,x)=p;println!("{} {}",*r,x);'), '1 42\n'],
  ['wildcard does not invalidate active whole borrow', main('let mut p=(1,2);let r=&mut p;let (_,_) = p;println!("{}",r.0);'), '1\n'],
  ['borrow sibling after destructuring move', main('let p=(String::from("a"),42);let (a,_)=p;let r=&p.1;println!("{} {}",a,*r);'), 'a 42\n'],
  ['reinitialize exact destructured field', main('let mut p=(String::from("a"),String::from("b"));let (a,_)=p;p.0=String::from("c");println!("{} {} {}",a,p.0,p.1);'), 'a c b\n'],
  ['whole reinitialization kills all pattern moves', main('let mut p=(String::from("a"),String::from("b"));let (a,b)=p;p=(String::from("c"),String::from("d"));println!("{} {} {} {}",a,b,p.0,p.1);'), 'a b c d\n'],
  ['array independent pattern elements', main('let p=[String::from("a"),String::from("b"),String::from("c")];let [a,..]=p;let [_,b,c]=p;println!("{} {} {}",a,b,c);'), 'a b c\n'],
  ['array rest move excludes wildcard prefix', main('let p=[String::from("a"),String::from("b"),String::from("c")];let [_,rest @ ..]=p;let [a,..]=p;println!("{} {} {}",a,rest[0],rest[1]);'), 'a b c\n'],
  ['empty rest consumes no elements', main('let p=[String::from("a")];let [_,empty @ ..]=p;let [a]=p;println!("{} {}",a,empty.len());'), 'a 0\n'],
  ['nonCopy at binding with Copy subpattern', main('let p=(String::from("a"),42);let all @ (_,n)=p;println!("{} {}",all.0,n);'), 'a 42\n'],
  ['Copy aggregate bindings do not alias', main('let p=([1,2],42);let (mut a,b)=p;a[0]=9;println!("{} {} {}",p.0[0],a[0],b);'), '1 9 42\n'],
  ['generic tuple under declared Copy evidence', 'fn pair<T:Copy>(p:(T,T))->(T,T){let(a,_)=p;let(_,b)=p;(a,b)}'+main('let p=pair((20,22));println!("{}",p.0+p.1);'), '42\n'],
  ['generic nonCopy field split', 'fn split<T>(p:(T,T))->(T,T){let(a,_)=p;let(_,b)=p;(a,b)}'+main('let p=split((String::from("a"),String::from("b")));println!("{} {}",p.0,p.1);'), 'a b\n'],
  ['if-let success only moves selected tuple field', main('let p=(Some(String::from("a")),String::from("b"));if let (Some(a),_)=p{println!("{} {}",a,p.1);}'), 'a b\n'],
  ['if-let failure retains original enum', main('let p:Option<String>=None;if let Some(a)=p{println!("{}",a);}else{println!("{}",p.is_none());}'), 'true\n'],
  ['single irrefutable if-let else has no success moves', main('let p=(String::from("a"),1);if let (a,_)=p{println!("{}",a);}else{println!("{}",p.0);}'), 'a\n'],
  ['let-else failure before source move', 'fn show(p:Option<String>){let Some(a)=p else{println!("{}",p.is_none());return;};println!("{}",a);}'+main('show(None);show(Some(String::from("a")));'), 'true\na\n'],
  ['let-else projected source move', main('let p=(Some(String::from("a")),String::from("b"));let (Some(a),_)=p else{return;};println!("{} {}",a,p.1);'), 'a b\n'],
  ['chain binds separate owned tuple fields', main('let p=(String::from("a"),String::from("b"));if let (a,_)=p && let (_,b)=p{println!("{} {}",a,b);}'), 'a b\n'],
  ['chain failure retains wildcard sibling', main('let p=(Some(String::from("a")),String::from("b"));if let (Some(a),_)=p && false{println!("{}",a);}else{println!("{}",p.1);}'), 'b\n'],
  ['while-let reinitializes only moved field', main('let mut p=(Some(String::from("a")),42);while let (Some(a),_)=p{println!("{} {}",a,p.1);p.0=None;}'), 'a 42\n'],
  ['while-let explicit break after move', main('let p=(Some(String::from("a")),42);while let (Some(a),_)=p{println!("{} {}",a,p.1);break;}'), 'a 42\n'],
  ['loop wildcard field can survive backedge', main('let p=(String::from("a"),42);let (a,_)=p;let mut n=0;while let (_,b)=p{n+=1;if n==2{println!("{} {}",a,b);break;}}'), 'a 42\n'],
  ['match guard rejection does not move candidate', main('let p=Some(String::from("a"));match p{Some(a) if false=>println!("{}",a),_=>println!("{}",p.unwrap())}'), 'a\n'],
  ['match guard can read candidate twice before commit', main('let p=Some(String::from("a"));match p{Some(a) if a.len()==1 && a.len()==1=>println!("{}",a),_=>{}}'), 'a\n'],
  ['match arms move only their bound fields', main('let p=(String::from("a"),String::from("b"),true);match p{(a,_,true)=>println!("{} {}",a,p.1),(_,b,false)=>println!("{} {}",p.0,b)}'), 'a b\n'],
  ['match literal read does not move nonCopy sibling', main('let p=(String::from("a"),1);match p{(_,1)=>println!("{}",p.0),_=>{}}'), 'a\n'],
  ['match wildcards can ignore a moved tuple', main('let p=(String::from("a"),1);let a=p.0;match p{(_,1)=>println!("{}",a),_=>{}}'), 'a\n'],
  ['failed guard preserves unrelated mutation', main('let p=Some(String::from("a"));let mut n=0;match p{Some(a) if {n=42;false}=>println!("{}",a),_=>println!("{} {}",n,p.unwrap())}'), '42 a\n'],
  ['guard permits mutation of unmatched sibling', main('let mut p=(1,2);match p{(x,_) if {p.1=42;true}=>println!("{} {}",x,p.1),_=>{}}'), '1 42\n'],
  ['or-pattern joins owned projections', main('let p=(String::from("a"),String::from("b"),false);match p{(a,_,true)|(_,a,false)=>println!("{}",a)}'), 'b\n'],
  ['or-pattern guarded alternatives do not move on rejection', main('let p=(String::from("a"),String::from("b"),false);match p{(a,_,true)|(_,a,false) if false=>println!("{}",a),_=>println!("{} {}",p.0,p.1)}'), 'a b\n'],
  ['direct shared reference if-let binding retains origin', main('let x=42;if let r=&x{println!("{}",*r);}'), '42\n'],
  ['direct mutable reference match binding reborrows after guard', main('let mut x=40;match &mut x{r if **&r==40=>{*r+=2;},_=>{}}println!("{}",x);'), '42\n'],
  ['owned rvalue constructor evaluated once', 'fn p()->(String,String){print!("p");(String::from("a"),String::from("b"))}'+main('let (a,b)=p();println!(" {} {}",a,b);'), 'p a b\n'],
  ['wildcard initializer side effects still execute', 'fn p()->String{print!("p");String::from("a")}'+main('let _=p();println!("!");'), 'p!\n'],
];
export const patternOwnershipCompileFailCases = [
  ['read moved destructured field', main('let p=(String::from("a"),42);let (a,_)=p;println!("{}",p.0);'), 'E0382'],
  ['move whole value after pattern partial move', main('let p=(String::from("a"),42);let (a,_)=p;let b=p;'), 'E0382'],
  ['move same field in a second pattern', main('let p=(String::from("a"),42);let (a,_)=p;let (b,_)=p;'), 'E0382'],
  ['read parent after nested move', main('let p=((String::from("a"),42),1);let ((a,_),_)=p;println!("{:?}",p.0);'), 'E0382'],
  ['sibling assignment cannot repair moved field', main('let mut p=(String::from("a"),42);let (a,_)=p;p.1=1;println!("{}",p.0);'), 'E0382'],
  ['move borrowed destructured field', main('let p=(String::from("a"),42);let r=&p.0;let (a,_)=p;println!("{}",r.len());'), 'E0502'],
  ['Copy binding reads exclusively borrowed field', main('let mut p=(1,2);let r=&mut p.0;let (a,_)=p;println!("{}",*r);'), 'E0503'],
  ['move pattern through shared reference', main('let p=(String::from("a"),42);let r=&p;let (a,_)=*r;'), 'E0507'],
  ['move pattern through mutable reference', main('let mut p=(String::from("a"),42);let r=&mut p;let (a,_)=*r;'), 'E0507'],
  ['move pattern through indexed collection', main('let p=[(String::from("a"),42)];let (a,_)=p[0];'), 'E0508'],
  ['indexed sibling read after array pattern move', main('let p=[String::from("a"),String::from("b")];let [a,..]=p;println!("{}",p[1]);'), 'E0382'],
  ['rest move invalidates its elements', main('let p=[String::from("a"),String::from("b")];let [_,r @ ..]=p;let [_,b]=p;'), 'E0382'],
  ['at pattern cannot duplicate generic nonCopy privilege', 'fn f<T>(p:(T,)){let all @ (x,)=p;}'+main('f((1,));'), 'E0382'],
  ['if-let success move reaches continuation', main('let p=Some(String::from("a"));if let Some(a)=p{}println!("{:?}",p);'), 'E0382'],
  ['enum discriminant after payload move', 'enum E{A(String),B}'+main('let p=E::A(String::from("a"));if let E::A(a)=p{}if let E::B=p{}'), 'E0382'],
  ['chain later operand cannot reuse moved field', main('let p=(String::from("a"),42);if let(a,_)=p && p.0.len()>0{}'), 'E0382'],
  ['while-let backedge sees moved field', main('let p=(Some(String::from("a")),42);while let(Some(a),_)=p{}'), 'E0382'],
  ['continue cannot skip pattern reinitialization', main('let mut p=(Some(String::from("a")),42);while let(Some(a),_)=p{if p.1>0{continue;}p.0=None;}'), 'E0382'],
  ['guard cannot move bound owned value', main('let p=Some(String::from("a"));match p{Some(a) if {let b=a;true}=>{},_=>{}}'), 'E0507'],
  ['guard cannot assign bound Copy value', main('let p=Some(1);match p{Some(mut a) if {a=2;true}=>{},_=>{}}'), 'E0594'],
  ['guard cannot replace borrowed scrutinee', main('let mut p=Some(1);match p{Some(a) if {p=None;true}=>println!("{}",a),_=>{}}'), 'E0502'],
  ['guard cannot mutate selected tuple field', main('let mut p=(1,2);match p{(a,_) if {p.0=3;true}=>println!("{}",a),_=>{}}'), 'E0502'],
  ['guard cannot mutate through mutable binding', main('let mut x=1;match &mut x{r if {*r=2;true}=>{},_=>{}}'), 'E0594'],
  ['guard cannot mutate builtin receiver', main('let mut x=vec![1];match &mut x{r if {r.push(2);true}=>{},_=>{}}'), 'E0594'],
  ['or-pattern join invalidates every possible moved field', main('let p=(String::from("a"),String::from("b"),true);match p{(a,_,true)|(_,a,false)=>{}}println!("{}",p.0);'), 'E0382'],
  ['generic pattern copy cannot be granted by specialization', 'fn f<T>(p:(T,)){let (a,)=p;let (b,)=p;}'+main('f((1,));'), 'E0382'],
  ['borrow partially moved source through helper', 'fn show<T>(x:&T){}'+main('let p=(String::from("a"),42);let(a,_)=p;show(&p);'), 'E0382'],
];

// Independent projection matrices: the sources also run through native rustc.
const paths = ['0.0','0.1','1.0','1.1'];
const pattern = (index, name = 'a') => {
  const leaves = Array.from({length:4}, (_,i) => i===index ? name : '_');
  return `((${leaves[0]},${leaves[1]}),(${leaves[2]},${leaves[3]}))`;
};
const owned = '((String::from("a"),String::from("bb")),(String::from("ccc"),String::from("dddd")))';
const add = (valid, name, body, result, code='E0382') => (valid ? patternOwnershipCases : patternOwnershipCompileFailCases).push([name, main(body), valid ? result : code]);
for (let selected=0;selected<4;selected++) for (let other=0;other<4;other++) {
  add(selected!==other, `matrix pattern move ${paths[selected]} versus read ${paths[other]}`,
    `let p=${owned};let ${pattern(selected)}=p;println!("{} {}",a.len(),p.${paths[other]}.len());`, `${selected+1} ${other+1}\n`);
  add(selected!==other, `matrix pattern move ${paths[selected]} versus existing loan ${paths[other]}`,
    `let mut p=${owned};let r=&mut p.${paths[other]};let ${pattern(selected)}=p;println!("{} {}",a.len(),r.len());`, `${selected+1} ${other+1}\n`, 'E0502');
  add(selected!==other, `matrix guard binding ${paths[selected]} versus mutation ${paths[other]}`,
    `let mut p=((1,2),(3,4));match p{${pattern(selected)} if {p.${paths[other]}=42;true}=>println!("{} {}",a,p.${paths[other]}),_=>{}}`, `${selected+1} 42\n`, 'E0502');
  add(selected===other, `matrix backedge pattern ${paths[selected]} versus reinitialization ${paths[other]}`,
    `let mut p=${owned};let mut n=0;while let ${pattern(selected)}=p{n+=1;print!("{} ",a.len());p.${paths[other]}=String::from("z");if n==2{break;}}`, `${selected+1} 1 `);
}
for (let first=0;first<4;first++) for (let second=first+1;second<4;second++) for (let read=0;read<4;read++) {
  const firstPattern=`(${pattern(first)},true)`, secondPattern=`(${pattern(second)},false)`;
  add(read!==first && read!==second, `matrix or-pattern ${paths[first]} or ${paths[second]} versus read ${paths[read]}`,
    `let p=(${owned},false);match p{${firstPattern}|${secondPattern}=>{print!("{} ",a.len());}}println!("{}",p.0.${paths[read]}.len());`, `${second+1} ${read+1}\n`);
}

const forward = 'fn same<T>(x:&T)->&T{x}';
for (const form of ['ifLet','chain','match','whileLet']) for (const earlyMutation of [false,true]) {
  const body = earlyMutation ? 'x=2;println!("{}",*r);' : 'println!("{}",*r);x=2;';
  const init = '{let s=&x;same(s)}';
  const expression = form==='ifLet' ? `if let r=${init}{${body}}` : form==='chain' ? `if let r=${init} && true{${body}}` :
    form==='match' ? `match ${init}{r=>{${body}}}` : `while let r=${init}{${body}break;}`;
  (earlyMutation ? patternOwnershipCompileFailCases : patternOwnershipCases).push([
    `${form} retains nested returned-reference loan ${earlyMutation?'until use':'then releases'}`,
    forward+main(`let mut x=1;${expression}`), earlyMutation?'E0502':'1\n']);
}
patternOwnershipCompileFailCases.push([
  'pattern result cannot extend a local referent scope',
  forward+main('if let r={let x=1;same(&x)}{println!("{}",*r);}'), 'E0597']);

export const patternOwnershipGuide = "struct Packet {\n    name: String,\n    payload: String,\n    sequence: u32,\n}\n\nfn main() {\n    let packet = Packet {\n        name: String::from(\"header\"),\n        payload: String::from(\"body\"),\n        sequence: 42,\n    };\n    let Packet {\n        name,\n        ..\n    } = packet;\n    match packet {\n        Packet {\n            payload,\n            sequence: 42,\n            ..\n        } if payload.len() > 0 => {\n            println!(\"{} {} {}\", name, payload, packet.sequence);\n        }\n        _ => {}\n    }\n}\n";
patternOwnershipCases.push(['executable projected-pattern guide', patternOwnershipGuide, 'header body 42\n']);
