/** Exact-source native/browser differential programs. Capability boundaries are
 * deliberately not included in the native compile-fail corpus. */
const main = body => `fn main(){${body}}`;
const pair = 'struct Pair{left:i32,right:i32}';
const owned = 'struct Pair{left:String,right:String}';
export const ownershipPlaceCases = [
  ['different fields of indexed elements remain disjoint', pair+main('let mut a=[Pair{left:0,right:0},Pair{left:0,right:0}];let r=&mut a[0].left;let s=&mut a[1].right;*r=1;*s=2;'), ''],
  ['move tuple fields independently', main('let p=(String::from("left"),String::from("right"));let a=p.0;let b=p.1;println!("{} {}",a,b);'), 'left right\n'],
  ['move record fields independently', owned+main('let p=Pair{left:String::from("left"),right:String::from("right")};let a=p.left;let b=p.right;println!("{} {}",a,b);'), 'left right\n'],
  ['read Copy sibling after partial move', main('let p=(String::from("left"),42);let a=p.0;println!("{} {}",a,p.1);'), 'left 42\n'],
  ['move nested fields independently', main('let p=((String::from("a"),String::from("b")),String::from("c"));let a=p.0.0;let b=p.0.1;let c=p.1;println!("{} {} {}",a,b,c);'), 'a b c\n'],
  ['reinitialize moved tuple field', main('let mut p=(String::from("a"),42);let a=p.0;p.0=String::from("b");let q=p;println!("{} {} {}",a,q.0,q.1);'), 'a b 42\n'],
  ['reinitialize all moved fields', main('let mut p=(String::from("a"),String::from("b"));let a=p.0;let b=p.1;p.0=String::from("c");p.1=String::from("d");let q=p;println!("{} {} {} {}",a,b,q.0,q.1);'), 'a b c d\n'],
  ['replace moved whole aggregate', main('let mut p=(String::from("a"),0);let q=p;p=(String::from("b"),42);println!("{} {}",q.0,p.1);'), 'a 42\n'],
  ['borrow sibling after partial move', main('let p=(String::from("a"),42);let a=p.0;let r=&p.1;println!("{} {}",a,*r);'), 'a 42\n'],
  ['mutable sibling loans', pair+main('let mut p=Pair{left:0,right:0};let a=&mut p.left;let b=&mut p.right;*a=20;*b=22;println!("{}",p.left+p.right);'), '42\n'],
  ['shared and mutable sibling loans', pair+main('let mut p=Pair{left:20,right:0};let a=&p.left;let b=&mut p.right;*b=22;println!("{}",*a+p.right);'), '42\n'],
  ['mutate unborrowed sibling', main('let mut p=(20,0);let r=&p.0;p.1=22;println!("{}",*r+p.1);'), '42\n'],
  ['nested subtree sibling loans', main('let mut p=((0,0),(0,0));let a=&mut p.0;let b=&mut p.1; a.0=20;b.1=22;println!("{}",p.0.0+p.1.1);'), '42\n'],
  ['move disjoint field while sibling borrowed', main('let p=(String::from("a"),String::from("b"));let r=&p.0;let b=p.1;println!("{} {}",*r,b);'), 'a b\n'],
  ['explicit mutable reborrow resumes parent', main('let mut x=0;let r=&mut x;let s=&mut *r;*s=20;*r+=22;println!("{}",x);'), '42\n'],
  ['shared reborrow freezes then releases parent', main('let mut x=20;let r=&mut x;let s=&*r;println!("{}",*s);*r=42;println!("{}",x);'), '20\n42\n'],
  ['grandchild mutable reborrow resumes ancestors', main('let mut x=0;let r=&mut x;let s=&mut *r;let t=&mut *s;*t=20;*s+=10;*r+=12;println!("{}",x);'), '42\n'],
  ['project reborrows of one mutable parent', pair+main('let mut p=Pair{left:0,right:0};let r=&mut p;let a=&mut r.left;let b=&mut r.right;*a=20;*b=22;println!("{}",p.left+p.right);'), '42\n'],
  ['disjoint parameter reborrows', pair+'fn fill(r:&mut Pair){let a=&mut r.left;let b=&mut r.right;*a=20;*b=22;}'+main('let mut p=Pair{left:0,right:0};fill(&mut p);println!("{}",p.left+p.right);'), '42\n'],
  ['shared reference copy preserves authority', main('let x=42;let r=&x;let s=r;println!("{} {}",*s,*r);'), '42 42\n'],
  ['mutable reference move preserves pointee authority', main('let mut x=0;let r=&mut x;let s=r;*s=42;println!("{}",x);'), '42\n'],
  ['block reference result preserves authority', main('let mut x=0;let r=&mut x;let s={r};*s=42;println!("{}",x);'), '42\n'],
  ['block reborrow result preserves authority', main('let mut x=0;let r=&mut x;let s={&mut *r};*s=20;*r+=22;println!("{}",x);'), '42\n'],
  ['conditional reference result', main('let mut x=0;let mut y=0;let r=if true{&mut x}else{&mut y};*r=42;println!("{}",x+y);'), '42\n'],
  ['match reference result', main('let mut x=0;let mut y=0;let r=match true{true=>&mut x,false=>&mut y};*r=42;println!("{}",x+y);'), '42\n'],
  ['branch-local last use permits alternative mutation', main('let mut x=20;let r=&x;if false{println!("{}",*r);}else{x=42;}println!("{}",x);'), '42\n'],
  ['reassign reference releases its old origin', main('let mut x=0;let y=22;let mut r=&x;println!("{}",*r);r=&y;x=20;println!("{}",x+*r);'), '0\n42\n'],
  ['conditional partial move excludes diverging arm', main('let p=(String::from("a"),42);if false{let a=p.0;return;}println!("{} {}",p.0,p.1);'), 'a 42\n'],
  ['reinitialize field on each loop backedge', main('let mut p=(String::from("a"),0);for i in 0..2{let a=p.0;println!("{}",a);p.0=String::from("b");}println!("{}",p.0);'), 'a\nb\nb\n'],
  ['move before unconditional loop break', main('let s=String::from("ok");loop{let t=s;println!("{}",t);break;}'), 'ok\n'],
  ['loop reference remains live across backedge', main('let x=42;let r=&x;for i in 0..2{println!("{}",*r);}'), '42\n42\n'],
  ['loop-local mutable loan is renewed', main('let mut x=0;for i in 0..3{let r=&mut x;*r+=14;}println!("{}",x);'), '42\n'],
  ['while loop reinitialization', main('let mut n=0;let mut s=String::from("a");while n<2{let t=s;println!("{}",t);s=String::from("b");n+=1;}println!("{}",s);'), 'a\nb\nb\n'],
  ['read other branch field after conditional move', main('let p=(String::from("a"),42);if true{let a=p.0;}println!("{}",p.1);'), '42\n'],
  ['parameter pointer storage is separate from referent', 'fn change(r:&mut i32){let s=r;*s=42;}'+main('let mut x=0;change(&mut x);println!("{}",x);'), '42\n'],
  ['indexed address evaluates once', 'fn index()->usize{println!("index");0}'+main('let mut a=[0];let r=&mut a[index()];*r=42;println!("{}",a[0]);'), 'index\n42\n'],
];

ownershipPlaceCases.push(
  ['guard false edge retains sibling loan', main('let mut p=(0,42);let r=&p.1;match 0{0 if {p.0=1;false}=>(),_=>println!("{}",*r)}'), '42\n'],
  ['guard reinitialization reaches following arm', main('let mut s=String::from("a");match 0{0 if {let t=s;s=String::from("b");false}=>(),_=>println!("{}",s)}'), 'b\n'],
  ['escaping condition copy ends at final use', main('let mut x=0;let y=1;let mut r=&y;if let s=&x && true{r=s;}println!("{}",*r);x=42;println!("{}",x);'), '0\n42\n'],
  ['label result carries outer reborrow', main("let mut x=42;let r='l:{let s=&mut x;break 'l s;};println!(\"{}\",*r);"), '42\n'],
  ['loop result carries outer reborrow', main('let mut x=42;let r=loop{let s=&mut x;break s;};println!("{}",*r);'), '42\n'],
);

ownershipPlaceCases.push(
  ['let else evaluates initializer before failure branch', 'fn source()->Option<i32>{println!("source");None}'+main('let Some(x)=source() else {println!("else");return;};println!("{}",x);'), 'source\nelse\n'],
  ['let else failure does not consume success loans', main('let mut x=42;let r=&x;let Some(y)=Some(1) else {x=0;return;};println!("{}",*r);'), '42\n'],
  ['call keeps expression loan but permits a disjoint argument', 'fn f(a:&i32,b:&mut i32){*b=2;println!("{}",*a);}'+main('let mut p=(42,0);let r=&p.0;f({r},&mut p.1);'), '42\n'],
);
export const ownershipPlaceCompileFailCases = [
  ['call protects block-valued reference argument', 'fn f(a:&i32,b:&mut i32){*b=2;println!("{}",*a);}'+main('let mut x=0;let r=&x;f({r},&mut x);'), 'E0502'],
  ['call protects conditional reference argument', 'fn f(a:&i32,b:&mut i32){*b=2;println!("{}",*a);}'+main('let mut x=0;let r=&x;f(if true{r}else{r},&mut x);'), 'E0502'],
  ['let else failure cannot erase successful edge loan', main('let mut x=0;let r=&x;let Some(y)=Some(1) else {x=1;return;};x=2;println!("{}",*r);'), 'E0502'],

  ['label result cannot escape local referent', main("let r='l:{let x=42;break 'l &x;};println!(\"{}\",*r);"), 'E0597'],
  ['loop result cannot escape local referent', main('let r=loop{let x=42;break &x;};println!("{}",*r);'), 'E0597'],
  ['loop exit cannot leak assignment to local', main('let x=0;let mut r=&x;loop{let y=42;r=&y;break;}println!("{}",*r);'), 'E0597'],
  ['continue cannot leak scoped referent', main('let x=0;let mut r=&x;for i in 0..2{let y=42;r=&y;continue;}println!("{}",*r);'), 'E0597'],
  ['false match guard preserves later arm loan', main('let mut x=0;let r=&x;match 1{0 if {x=1;false}=>(),_=>println!("{}",*r)}'), 'E0502'],
  ['false match guard preserves move effects', main('let s=String::from("a");match 0{0 if {let t=s;false}=>(),_=>println!("{}",s)}'), 'E0382'],
  ['condition copy retains loan after condition scope', main('let mut x=0;let y=1;let mut r=&y;if let s=&x && true{r=s;}x=2;println!("{}",*r);'), 'E0502'],
  ['new loan survives reference assignment destination write', main('let mut x=0;let y=1;let mut r=&y;r=&x;x=2;println!("{}",*r);'), 'E0502'],

  ['block result cannot reference a block local', main('let r={let x=42;&x};println!("{}",*r);'), 'E0597'],
  ['assignment cannot leak block local through outer pointer', main('let x=0;let mut r=&x;{let y=42;r=&y;}println!("{}",*r);'), 'E0597'],
  ['conditional reference assignment preserves the other path', main('let mut x=0;let y=1;let mut r=&x;if false{r=&y;}x=2;println!("{}",*r);'), 'E0502'],
  ['returned mutable alias blocks direct mutation', main('let mut x=0;let r=&mut x;let s={r};x=1;println!("{}",*s);'), 'E0502'],
  ['move one field twice', main('let p=(String::from("a"),42);let a=p.0;let b=p.0;'), 'E0382'],
  ['consume partially moved aggregate', main('let p=(String::from("a"),42);let a=p.0;let q=p;'), 'E0382'],
  ['borrow partially moved aggregate', main('let p=(String::from("a"),42);let a=p.0;let r=&p;'), 'E0382'],
  ['moving parent after child move', main('let p=((String::from("a"),42),0);let a=p.0.0;let q=p.0;'), 'E0382'],
  ['read descendant after parent move', main('let p=((String::from("a"),42),0);let a=p.0;println!("{}",p.0.1);'), 'E0382'],
  ['sibling write does not resurrect moved field', main('let mut p=(String::from("a"),0);let a=p.0;p.1=42;println!("{}",p.0);'), 'E0382'],
  ['field write cannot reinitialize moved whole', main('let mut p=(String::from("a"),0);let q=p;p.0=String::from("b");'), 'E0382'],
  ['compound assignment reads moved field', main('let mut p=(String::from("a"),0);let q=p;p.1+=1;'), 'E0382'],
  ['non Copy array element cannot be moved by index', main('let a=[String::from("a")];let x=a[0];'), 'E0508'],
  ['non Copy vector element cannot be moved by index', main('let a=vec![String::from("a")];let x=a[0];'), 'E0508'],
  ['nested non Copy move through explicit dereference', main('let p=(String::from("a"),0);let r=&p;let x=(*r).0;'), 'E0507'],
  ['nested non Copy move through auto dereference', main('let p=((String::from("a"),0),0);let r=&p;let x=r.0.0;'), 'E0507'],
  ['same mutable field twice', main('let mut p=(0,0);let a=&mut p.0;let b=&mut p.0;*a=1;*b=2;'), 'E0502'],
  ['mutable field blocks direct read', main('let mut p=(0,0);let a=&mut p.0;println!("{}",p.0);*a=1;'), 'E0503'],
  ['shared field blocks mutation', main('let mut p=(0,0);let a=&p.0;p.0=1;println!("{}",*a);'), 'E0502'],
  ['whole aggregate loan overlaps field', main('let mut p=(0,0);let a=&p;let b=&mut p.1;println!("{}",a.0);*b=2;'), 'E0502'],
  ['field loan overlaps whole aggregate', main('let mut p=(0,0);let a=&p.0;let b=&mut p;println!("{}",*a);b.1=2;'), 'E0502'],
  ['subtree loan overlaps nested field', main('let mut p=((0,0),0);let a=&mut p.0;let b=&p.0.1;a.0=2;println!("{}",*b);'), 'E0503'],
  ['move borrowed field', main('let p=(String::from("a"),0);let a=&p.0;let b=p.0;println!("{}",*a);'), 'E0502'],
  ['indexed mutable loans conservatively overlap', main('let mut a=[0,0];let r=&mut a[0];let s=&mut a[1];*r=1;*s=2;'), 'E0502'],
  ['mutable child freezes parent write', main('let mut x=0;let r=&mut x;let s=&mut *r;*r=1;println!("{}",*s);'), 'E0502'],
  ['mutable child freezes parent read', main('let mut x=0;let r=&mut x;let s=&mut *r;println!("{}",*r);*s=1;'), 'E0503'],
  ['mutable child freezes original storage', main('let mut x=0;let r=&mut x;let s=&mut *r;x=1;println!("{}",*s);'), 'E0502'],
  ['shared child freezes parent write', main('let mut x=0;let r=&mut x;let s=&*r;*r=1;println!("{}",*s);'), 'E0502'],
  ['mutable sibling reborrows overlap', main('let mut x=0;let r=&mut x;let s=&mut *r;let t=&mut *r;*s=1;*t=2;'), 'E0502'],
  ['grandchild freezes ancestor', main('let mut x=0;let r=&mut x;let s=&mut *r;let t=&mut *s;*r=1;println!("{}",*t);'), 'E0502'],
  ['copied shared reference retains loan', main('let mut x=0;let r=&x;let s=r;x=1;println!("{}",*s);'), 'E0502'],
  ['moved mutable reference cannot be reused', main('let mut x=0;let r=&mut x;let s=r;*r=1;*s=2;'), 'E0382'],
  ['block reference result keeps origin borrowed', main('let mut x=0;let r=&x;let s={r};x=1;println!("{}",*s);'), 'E0502'],
  ['branch reference result retains both origins', main('let mut x=0;let mut y=0;let r=if true{&x}else{&y};x=1;println!("{}",*r);'), 'E0502'],
  ['branch continuation retains earlier shared loan', main('let mut x=0;let r=&x;if false{println!("{}",*r);}else{x=1;}println!("{}",*r);'), 'E0502'],
  ['ordinary loop retains loan across backedge', main('let mut x=0;let r=&x;for i in 0..2{println!("{}",*r);x+=1;}'), 'E0502'],
  ['while retains loan across backedge', main('let mut x=0;let r=&x;while x<2{println!("{}",*r);x+=1;}'), 'E0502'],
  ['continue skips required field reinitialization', main('let mut p=(String::from("a"),0);for i in 0..2{let a=p.0;if i==0{continue;}p.0=String::from("b");}'), 'E0382'],
  ['repeat move on loop backedge', main('let s=String::from("a");for i in 0..2{let t=s;}'), 'E0382'],
  ['conditional move survives skipped branch', main('let p=(String::from("a"),0);if false{let a=p.0;}let q=p;'), 'E0382'],
];

// Complete small projection/authority matrix. Expected outcomes are specified
// independently of the checker and also validated by native rustc in CI.
for (const reborrow of [false, true]) for (const left of ['0', '0.0', '0.1', '1'])
  for (const right of ['0', '0.0', '0.1', '1']) for (const firstMutable of [false, true])
    for (const secondMutable of [false, true]) {
      const overlaps = left === right || left.startsWith(right + '.') || right.startsWith(left + '.');
      const read = (name, path) => path.includes('.') ? `*${name}` : `${name}.0`;
      const base = reborrow ? 'parent' : 'p';
      const source = main(`let mut p=((0,0),(0,0));${reborrow ? 'let parent=&mut p;' : ''}` +
        `let a=&${firstMutable ? 'mut ' : ''}${base}.${left};let b=&${secondMutable ? 'mut ' : ''}${base}.${right};` +
        `println!("{} {}",${read('a', left)},${read('b', right)});`);
      const name = `projection matrix ${reborrow ? 'reborrow' : 'owned'} ${firstMutable ? 'mut' : 'shared'} ${left} / ${secondMutable ? 'mut' : 'shared'} ${right}`;
      if (overlaps && (firstMutable || secondMutable))
        ownershipPlaceCompileFailCases.push([name, source, secondMutable ? 'E0502' : 'E0503']);
      else ownershipPlaceCases.push([name, source, '0 0\n']);
    }
