// Exact-source native differential cases. Native-valid capability gaps belong
// in separate tests, never in the compile-fail oracle.
export const matchErgonomicsCases = [
  ['explicit shared reference value', 'fn main(){let n=42;let &x=&n;println!("{}",x);}', '42\n'],
  ['explicit mutable reference copies pointee', 'fn main(){let mut n=40;let &mut x=&mut n;n+=2;println!("{} {}",x,n);}', '40 42\n'],
  ['adjacent ampersands in nested reference pattern', 'fn main(){let n=42;let r=&n;let rr=&r;let &&x=rr;println!("{}",x);}', '42\n'],
  ['nested reference pattern binds inner shared handle', 'fn main(){let n=42;let r=&n;let rr=&r;let &x=rr;println!("{}",*x);}', '42\n'],
  ['shared tuple default binding mode', 'fn main(){let p=(40,2);let (x,y)=&p;println!("{}",*x+*y);}', '42\n'],
  ['mutable tuple default binding mode', 'fn main(){let mut p=(40,2);let (x,y)=&mut p;*x+=*y;println!("{}",p.0);}', '42\n'],
  ['mutable handle storage need not be mutable', 'fn main(){let mut p=(40,2);let r=&mut p;let (x,y)=r;*x+=*y;println!("{}",p.0);}', '42\n'],
  ['shared edge remains shared beneath mutable reference', 'fn main(){let mut p=(40,2);let r=&mut p;let rr=&r;let (x,y)=rr;let a:&i32=x;let b:&i32=y;println!("{}",*a+*b);}', '42\n'],
  ['nested mutable reference prefixes', 'fn main(){let mut p=(40,2);let mut r=&mut p;let rr=&mut r;let (x,y)=rr;*x+=*y;println!("{}",p.0);}', '42\n'],
  ['explicit prefix restores by-value binding', 'fn main(){let p=(40,2);let &(x,y)=&p;println!("{} {}",x,y);}', '40 2\n'],
  ['explicit prefix allows ref and ref mut', 'fn main(){let mut p=(40,2);let &mut(ref mut x,ref y)=&mut p;*x+=*y;println!("{}",p.0);}', '42\n'],
  ['explicit prefix permits mutable Copy binding', 'fn main(){let p=(40,);let &(mut x,)=&p;x+=2;println!("{} {}",x,p.0);}', '42 40\n'],
  ['reference pattern identifier at precedence', 'fn main(){let n=42;let &x @ 40..=45=&n else{return};println!("{}",x);}', '42\n'],
  ['reference pattern parenthesized alternatives', 'fn main(){let n=42;println!("{}",match &n{&(1|42)=>7,_=>0});}', '7\n'],
  ['implicit literal and range matching', 'fn main(){let n=42;println!("{}",match &n{0=>0,40..=45=>1,_=>2});}', '1\n'],
  ['implicit bool coverage', 'fn main(){let b=false;println!("{}",match &b{true=>1,false=>2});}', '2\n'],
  ['explicit bool coverage', 'fn main(){let b=true;println!("{}",match &b{&true=>1,&false=>2});}', '1\n'],
  ['constant name under explicit reference prefix', 'const N:i32=42;fn main(){let n=42;println!("{}",match &n{&N=>1,_=>0});}', '1\n'],
  ['record default binding and field shorthand', 'struct P{left:i32,right:i32}fn main(){let mut p=P{left:40,right:2};let P{left,right}=&mut p;*left+=*right;println!("{}",p.left);}', '42\n'],
  ['tuple struct borrowed pattern', 'struct P(i32,i32);fn main(){let p=P(40,2);let P(x,y)=&p;println!("{}",*x+*y);}', '42\n'],
  ['generic transparent alias borrowed pattern', 'struct P<T>{left:T,right:T}type Pair<T>=P<T>;fn main(){let p:Pair<i32>=P{left:40,right:2};let Pair{left:x,right:y}=&p;println!("{}",*x+*y);}', '42\n'],
  ['enum payload default binding', 'fn main(){let mut p=Some(40);if let Some(x)=&mut p{*x+=2;}println!("{}",p.unwrap());}', '42\n'],
  ['enum record borrowed pattern', 'enum E{A{x:i32,y:i32},B}fn main(){let mut p=E::A{x:40,y:2};match &mut p{E::A{x,y}=>{*x+=*y;println!("{}",*x);},E::B=>{}}}', '42\n'],
  ['unit and payload variants use borrowed coverage', 'enum E{A,B(i32)}fn main(){let p=E::B(42);println!("{}",match &p{E::A=>0,E::B(x)=>*x});}', '42\n'],
  ['default mode resets between alternatives', 'fn main(){let p=Some(42);match &p{Some(x)|Some(x)=>println!("{}",*x),None=>{}}}', '42\n'],
  ['nested at pattern binds borrowed aggregate', 'fn main(){let p=Some((40,2));if let Some(all @ (x,y))=&p{println!("{} {} {}",all.0,*x,*y);}}', '40 40 2\n'],
  ['outer at binder retains shared handle type', 'fn main(){let p=Some(42);if let all @ Some(x)=&p{println!("{} {}",all.is_some(),*x);}}', 'true 42\n'],
  ['fixed array implicit field loans', 'fn main(){let mut a=[40,2];let [x,y]=&mut a;*x+=*y;println!("{}",a[0]);}', '42\n'],
  ['fixed array unbound middle rest', 'fn main(){let a=[40,0,0,2];let [x,..,y]=&a;println!("{}",*x+*y);}', '42\n'],
  ['borrowed empty tuple', 'fn main(){let p=();let ()=&p;println!("ok");}', 'ok\n'],
  ['borrowed empty array', 'fn main(){let a:[i32;0]=[];let []=&a;println!("ok");}', 'ok\n'],
  ['by-value noncopy data is not moved by inferred binding', 'fn main(){let p=(vec![1,2],vec![3]);let (x,y)=&p;println!("{} {} {}",x.len(),y.len(),p.0.len());}', '2 1 2\n'],
  ['mutation of borrowed noncopy enum payload', 'fn main(){let mut p=Some(vec![40]);if let Some(x)=&mut p{x.push(2);}println!("{}",p.unwrap().len());}', '2\n'],
  ['returned shared pattern reference follows input contract', 'fn first<T>(p:&(T,T))->&T{let (x,_)=p;x}fn main(){let p=(40,2);println!("{}",*first(&p));}', '40\n'],
  ['returned mutable pattern reference follows input contract', 'fn first<T>(p:&mut(T,T))->&mut T{let (x,_)=p;x}fn main(){let mut p=(40,2);*first(&mut p)+=2;println!("{}",p.0);}', '42\n'],
  ['generic Copy value beneath explicit prefix', 'fn first<T:Copy>(p:&(T,T))->T{let &(x,_)=p;x}fn main(){let p=(42,2);println!("{}",first(&p));}', '42\n'],
  ['generic borrowed output preserves abstract item', 'struct P<T>(T);fn get<T>(p:&P<T>)->&T{let P(x)=p;x}fn main(){let p=P(vec![1,2]);println!("{}",get(&p).len());}', '2\n'],
  ['computed source pointer runs once', 'fn get(p:&mut(i32,i32))->&mut(i32,i32){print!("g");p}fn main(){let mut p=(40,2);let(x,y)=get(&mut p);*x+=*y;println!(" {}",p.0);}', 'g 42\n'],
  ['side-effecting source index runs once', 'fn index()->usize{print!("i");0}fn main(){let mut p=[(40,2)];let(x,y)=&mut p[index()];*x+=*y;println!(" {}",p[0].0);}', 'i 42\n'],
  ['let chain propagates borrowed bindings', 'fn main(){let p=Some((40,2));if let Some((x,y))=&p && *x>0{println!("{}",*x+*y);}else{println!("bad");}}', '42\n'],
  ['let else propagates borrowed bindings', 'fn main(){let p=Some(42);let Some(x)=&p else{return};println!("{}",*x);}', '42\n'],
  ['while let expires iteration-local loans', 'fn main(){let mut p=Some(40);let mut n=0;while let Some(x)=&mut p{*x+=1;n+=1;if n==2{break;}}println!("{}",p.unwrap());}', '42\n'],
  ['while chain short-circuits borrowed bindings', 'fn main(){let mut p=Some(40);while let Some(x)=&mut p && *x<42{*x+=1;}println!("{}",p.unwrap());}', '42\n'],
  ['guard reads inferred reference and commits after selection', 'fn main(){let mut p=Some(40);match &mut p{Some(x) if *x==40=>{*x+=2;},_=>{}}println!("{}",p.unwrap());}', '42\n'],
  ['failed guard releases candidate pattern loans', 'fn main(){let mut p=Some(40);match &mut p{Some(x) if *x==0=>{*x+=10;},Some(x)=>{*x+=2;},None=>{}}println!("{}",p.unwrap());}', '42\n'],
  ['closure explicit borrowed scrutinee remains repeatable', 'fn main(){let p=(40,2);let f=||{let(x,y)=&p;*x+*y};println!("{} {}",f(),f());}', '42 42\n'],
  ['closure mutable scrutinee retains mutable capture', 'fn main(){let mut p=(40,2);let mut f=||{let(x,_)=&mut p;*x+=1;};f();f();println!("{}",p.0);}', '42\n'],
  ['shared pointer copy severs outer storage loan', 'fn main(){let a=1;let b=2;let mut r=&a;let rr=&r;let &&ref x=rr;r=&b;println!("{} {}",*x,*r);}', '1 2\n'],
  ['explicit shared extraction copies inner handle', 'fn main(){let a=1;let b=2;let mut r=&a;let rr=&r;let &x=rr;r=&b;println!("{} {}",*x,*r);}', '1 2\n'],
  ['partial moved field is skipped behind borrowed handle', 'fn main(){let mut p=(vec![1],vec![2]);let moved=p.0;let (_,ref mut x)=p;x.push(3);println!("{} {}",moved.len(),x.len());}', '1 2\n'],
];
export const matchErgonomicsCompileFailCases = [
  ['named constant preserves exact declared type', 'const N:i32=42;fn main(){let n=42;println!("{}",match &n{N=>1,_=>0});}', 'E0308'],
  ['alternative binding modes retain written syntax', 'fn main(){let p=Some(42);match &p{Some(x)|&Some(ref x)=>println!("{}",*x),None=>{}}}', 'E0409'],
  ['shared pattern does not match mutable reference', 'fn main(){let mut n=1;let &x=&mut n;}', 'E0308'],
  ['mutable pattern does not match shared reference', 'fn main(){let n=1;let &mut x=&n;}', 'E0308'],
  ['reference pattern rejects a nonreference', 'fn main(){let &x=42;}', 'E0308'],
  ['explicit ref after implicit prefix is invalid in 2024', 'fn main(){let p=(1,);let (ref x,)=&p;}', 'E0003'],
  ['explicit ref mut after implicit prefix is invalid in 2024', 'fn main(){let mut p=(1,);let (ref mut x,)=&mut p;}', 'E0003'],
  ['explicit mut after implicit prefix is invalid in 2024', 'fn main(){let p=(1,);let (mut x,)=&p;}', 'E0003'],
  ['explicit reference after implicit prefix is invalid in 2024', 'fn main(){let n=1;let p=(&n,);let (&x,)=&p;}', 'E0003'],
  ['shared prefix cannot create exclusive pattern loan', 'fn main(){let p=(1,);let &(ref mut x,)=&p;*x+=1;}', 'E0596'],
  ['shared storage edge cannot recover unique access', 'fn main(){let mut p=(1,);let r=&mut p;let rr=&r;let &( &mut(ref mut x,))=rr;*x+=1;}', 'E0596'],
  ['inferred shared binding is not writable', 'fn main(){let p=(1,);let (x,)=&p;*x+=1;}', 'E0594'],
  ['shared sticky binding is not writable through mutable inner', 'fn main(){let mut p=(1,);let r=&mut p;let rr=&r;let (x,)=rr;*x+=1;}', 'E0594'],
  ['noncopy move through shared prefix', 'fn main(){let p=vec![1];let &x=&p;println!("{}",x.len());}', 'E0507'],
  ['noncopy move through mutable prefix', 'fn main(){let mut p=vec![1];let &mut x=&mut p;println!("{}",x.len());}', 'E0507'],
  ['noncopy field move through explicit reference', 'fn main(){let p=(vec![1],2);let &(x,_)=&p;println!("{}",x.len());}', 'E0507'],
  ['mutable reference handle cannot be extracted by value', 'fn main(){let mut n=1;let mut r=&mut n;let rr=&mut r;let &mut x=rr;*x+=1;}', 'E0507'],
  ['borrowed tuple prevents conflicting original mutation', 'fn main(){let mut p=(1,2);let (x,_)=&p;p.0=3;println!("{}",*x);}', 'E0502'],
  ['mutable pattern prevents conflicting original read', 'fn main(){let mut p=(1,2);let (x,_)=&mut p;println!("{}",p.0);*x+=1;}', 'E0503'],
  ['parent borrow is not narrowed by inspecting pattern', 'fn main(){let mut p=(1,2);let (x,_)=&mut p;p.1=3;*x+=1;}', 'E0502'],
  ['mutable whole handle and implicit child cannot coexist', 'fn main(){let mut p=Some(1);let all @ Some(x)=&mut p else{return};println!("{}",*x);}', 'E0505'],
  ['guard cannot mutate inferred reference binding', 'fn main(){let mut p=Some(1);match &mut p{Some(x) if {*x+=1;true}=>{},_=>{}}}', 'E0594'],
  ['nonexhaustive borrowed bool', 'fn main(){let b=false;match &b{true=>{}}}', 'E0004'],
  ['refutable reference local', 'fn main(){let n=2;let &1=&n;}', 'E0005'],
  ['inconsistent inferred and value alternative', 'fn main(){let p=Some(1);match &p{Some(x)|&Some(x)=>{},None=>{}}}', 'E0308'],
  ['duplicate inferred pattern binding', 'fn main(){let p=(1,2);let(x,x)=&p;}', 'E0416'],
  ['pattern does not borrow in its failure branch', 'fn main(){let p=Some(1);if let Some(x)=&p{}else{println!("{}",*x);}}', 'E0425'],
  ['generic concrete reference cannot grant pattern shape', 'fn f<T>(v:T){let &x=v;}fn main(){let n=1;f(&n);}', 'E0308'],
  ['generic concrete reference cannot grant implicit pattern shape', 'fn f<T>(v:T){let(x,)=v;}fn main(){let p=(1,);f(&p);}', 'E0308'],
  ['generic concrete Copy cannot permit pointee moves', 'fn f<T>(v:&(T,T)){let &(x,_)=v;}fn main(){let p=(1,2);f(&p);}', 'E0507'],
  ['returned reference retains parent call loan', 'fn get(p:&mut(i32,i32))->&mut(i32,i32){p}fn main(){let mut p=(1,2);let(x,_)=get(&mut p);p.1=3;*x+=1;}', 'E0502'],
  ['mutable pointer storage is retained through reborrows', 'fn main(){let mut a=1;let mut b=2;let mut r=&mut a;let rr=&mut r;let &mut &mut ref mut x=rr;r=&mut b;*x+=1;}', 'E0502'],
  ['borrowed local cannot escape pattern result', 'fn f(v:&i32)->&i32{let p=(1,);let(x,)=&p;x}fn main(){let n=0;f(&n);}', 'E0515'],
  ['borrowed block local cannot escape via outer reference', 'fn main(){let zero=0;let mut r=&zero;{let p=(1,);let(x,)=&p;r=x;}println!("{}",*r);}', 'E0597'],
];
// 4 selected leaves x 4 accessed leaves x 2 loan modes x 2 access modes.
// The supplied &mut handle retains its original whole-parent borrow, while
// reborrowing a field permits independent access through that same handle.
for (let selected=0;selected<4;selected++) for(let accessed=0;accessed<4;accessed++)
  for(const mutable of [false,true]) for(const write of [false,true]) {
    const leaf=i=>`${i>>1}.${i&1}`;
    const items=Array.from({length:4},(_,i)=>i===selected?(mutable?'x':'ref x'):'_');
    const nested=`((${items[0]},${items[1]}),(${items[2]},${items[3]}))`;
    const action=write?`r.${leaf(accessed)}+=1;`:`println!("{}",r.${leaf(accessed)});`;
    const source=`fn main(){let mut p=((10,20),(30,40));let r=&mut p;let ${mutable?'':'&mut'}${nested}=r;${action}println!("{}",*x);}`;
    const name=`match reference matrix ${selected}/${accessed} ${mutable?'exclusive':'shared'} ${write?'write':'read'}`;
    if(selected===accessed&&(mutable||write)) matchErgonomicsCompileFailCases.push([name,source,write?'E0502':'E0503']);
    else matchErgonomicsCases.push([name,source,`${write?'':10*(accessed+1)+'\n'}${10*(selected+1)}\n`]);
  }
matchErgonomicsCases.push(
  ['reference wildcard does not move mutable handle', 'fn main(){let mut n=40;let r=&mut n;let &mut _=r;*r+=2;println!("{}",n);}', '42\n'],
  ['unit enum binding resolves before default matching', 'enum E{A,B}use E::A;fn main(){let p=E::A;println!("{}",match &p{A=>42,_=>0});}', '42\n'],
  ['associated constant retains explicit prefix', 'struct P;impl P{const N:i32=42;}fn main(){let n=42;println!("{}",match &n{&P::N=>1,_=>0});}', '1\n'],
  ['constant range endpoints follow matched scalar', 'const LO:i32=40;const HI:i32=42;fn main(){let n=41;println!("{}",match &n{LO..=HI=>1,_=>0});}', '1\n'],
  ['explicit negative and character ranges', "fn main(){let n=-4;let c='a';println!(\"{} {}\",match &n{&(-5..=0)=>1,_=>0},match &c{'a'..='z'=>2,_=>0});}", '1 2\n'],
  ['nested implicit prefixes type independent siblings', 'struct P{a:(i32,),b:(i32,)}fn main(){let mut p=P{a:(40,),b:(2,)};let P{a:(x,),b:(y,)}=&mut p;*x+=*y;println!("{}",p.a.0);}', '42\n'],
  ['shared borrowed value may return after other arm', 'fn first(p:&Option<i32>)->&i32{match p{Some(x)=>x,None=>panic!("empty")}}fn main(){let p=Some(42);println!("{}",*first(&p));}', '42\n'],
  ['by-value binding in later match arm does not inherit ref', 'fn main(){let p=Some(42);match &p{Some(x) if *x==0=>{},whole=>println!("{}",whole.is_some())}}', 'true\n'],
  ['nested match inside failed guard keeps outer modes', 'fn main(){let p=Some((40,2));match &p{Some((x,y)) if match *y{0=>true,_=>false}=>println!("{}",*x),Some((x,y))=>println!("{}",*x+*y),None=>{}}}', '42\n'],
  ['explicit reference or-pattern swaps shared fields', 'fn main(){let p=(40,2);match &p{&(ref x,ref y)|&(ref y,ref x)=>println!("{}",*x+*y)}}', '42\n'],
  ['shared default mode permits multiple overlapping bindings', 'fn main(){let p=((40,2),);let (all @ (x,y),)=&p;println!("{} {}",all.0+all.1,*x+*y);}', '42 42\n'],
  ['borrowed loop continue retains header reborrow rules', 'fn main(){let mut p=Some(39);while let Some(x)=&mut p{*x+=1;if *x<42{continue;}break;}println!("{}",p.unwrap());}', '42\n'],
  ['earlier chain binding in nested borrowed operand', 'fn main(){let p=Some(Some(42));if let Some(x)=&p && let Some(y)=x{println!("{}",*y);}}', '42\n'],
  ['borrowed match result lives through last use', 'fn main(){let mut p=Some(40);let r=match &mut p{Some(x)=>x,None=>return};*r+=2;println!("{}",p.unwrap());}', '42\n'],
);
matchErgonomicsCompileFailCases.push(
  ['associated constant cannot erase reference level', 'struct P;impl P{const N:i32=42;}fn main(){let n=42;match &n{P::N=>{},_=>{}}}', 'E0308'],
  ['reference range without parentheses', 'fn main(){let n=42;match &n{&1..=42=>{},_=>{}}}', 'E0003'],
  ['borrowed record cannot move inferred noncopy binding', 'struct P{v:Vec<i32>}fn main(){let p=P{v:vec![1]};let P{v}=&p;let x:Vec<i32>=v;}', 'E0308'],
  ['nested default mutable binding remains immutable handle', 'fn main(){let mut p=(40,);let(x,)=&mut p;let mut n=2;x=&mut n;}', 'E0596'],
  ['mutable nested pattern cannot alias whole subaggregate', 'fn main(){let mut p=((1,2),);let(all @ (x,y),)=&mut p;*x+=1;println!("{}",all.0);}', 'E0499'],
  ['borrowed enum reference survives receiving match', 'fn main(){let mut p=Some(1);let r=match &p{Some(x)=>x,None=>return};p=Some(2);println!("{}",*r);}', 'E0502'],
  ['constant in tuple does not inherit literal auto deref', 'const N:i32=42;fn main(){let n=42;let p=(&n,);match p{(N,)=>{},_=>{}}}', 'E0308'],
  ['exclusive alternative loans remain exclusive', 'fn main(){let mut p=(1,2);let r=&mut p;match r{(x,_)|(_,x)=>{let y=&mut r.0;println!("{} {}",*x,*y);}}}', 'E0502'],
);

export const matchErgonomicsCapabilityCases = [
  ['untracked aggregate pointer storage', 'fn main(){let a=(40,);let mut b=(2,);let (&(x,),&mut(ref mut y,))=(&a,&mut b);*y+=x;println!("{}",b.0);}', 'F_PATTERN_REFERENCE'],
  ['inferred borrowed array rest', 'fn main(){let a=[1,2,3];let [_,r @ ..]=&a;println!("{}",r[0]);}', 'F_PATTERN_BORROW'],
  ['adjacent reference rvalue promotion', 'fn main(){let n=42;let &&x=&&n;println!("{}",x);}', 'E0070'],
];

export const matchErgonomicsGuide = `struct Pair<T> {
    left: T,
    right: T,
}

fn first<T>(pair: &mut Pair<T>) -> &mut T {
    let Pair {
        left,
        ..
    } = pair;
    left
}

fn main() {
    let mut pair = Pair {
        left: 40,
        right: 2,
    };
    *first(&mut pair) += 2;

    // The explicit reference prefix copies the scalar, not its reference.
    let &snapshot = &pair.left;

    // The constructor pattern borrows its payload without moving the Option.
    let value = Some((snapshot, pair.right));
    if let Some((left, right)) = &value {
        println!("{} {}", *left, *right);
    }
    println!("{}", value.is_some());
}
`;
matchErgonomicsCases.push(['complete match ergonomics guide',matchErgonomicsGuide,'42 2\ntrue\n']);
