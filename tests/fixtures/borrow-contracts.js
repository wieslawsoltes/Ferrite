/** Shared exact Rust sources for browser and native lifetime-contract checks. */
const main = body => `fn main(){${body}}`;
const shared = 'fn id(x:&i32)->&i32{x}';
const unique = 'fn id(x:&mut i32)->&mut i32{x}';
const put = 'fn put(x:&mut i32,n:i32){*x=n;}';
const item = 'struct Cell<T>{value:T}impl<T> Cell<T>{fn get(&self)->&T{&self.value}fn get_mut(&mut self)->&mut T{&mut self.value}}';
const pair = 'struct Pair{left:i32,right:i32}impl Pair{fn left(&mut self)->&mut i32{&mut self.left}fn read(&self)->&i32{&self.left}}';
export const borrowContractCases = [
  ['shared function result', shared + main('let x=42;let r=id(&x);println!("{}",*r);'), '42\n'],
  ['unique function result', unique + main('let mut x=0;let r=id(&mut x);*r=42;println!("{}",x);'), '42\n'],
  ['returned shared loan expires at last reachable use', shared + main('let mut x=0;let r=id(&x);println!("{}",*r);x=42;println!("{}",x);'), '0\n42\n'],
  ['discarded result releases call loan', unique + main('let mut x=0;id(&mut x);x=42;println!("{}",x);'), '42\n'],
  ['nested direct calls retain origin', shared + main('let x=42;println!("{}",*id(id(&x)));'), '42\n'],
  ['nested mutable calls resume original reference', unique + main('let mut x=0;let r=&mut x;let s=id(id(r));*s=20;*r+=22;println!("{}",x);'), '42\n'],
  ['projected argument contracts remain disjoint', unique + main('let mut p=(0,0);let a=id(&mut p.0);let b=id(&mut p.1);*a=20;*b=22;println!("{}",p.0+p.1);'), '42\n'],
  ['returned reference is immediate mutable reborrow operand', unique + main('let mut x=0;let r=&mut *id(&mut x);*r=42;println!("{}",x);'), '42\n'],
  ['returned mutable reference can be shared reborrowed', unique + main('let mut x=42;let r=&*id(&mut x);println!("{}",*r);x=1;'), '42\n'],
  ['shared copies retain result authority', shared + main('let x=42;let a=id(&x);let b=a;let c=b;println!("{} {} {}",*a,*b,*c);'), '42 42 42\n'],
  ['mutable handle move retains returned referent', unique + main('let mut x=0;let a=id(&mut x);let b=a;*b=42;println!("{}",x);'), '42\n'],
  ['reassignment releases old returned referent', shared + main('let mut x=1;let y=42;let mut r=id(&x);println!("{}",*r);r=id(&y);x=2;println!("{}",*r);'), '1\n42\n'],
  ['return contract follows forwarding helper', shared + 'fn forward(x:&i32)->&i32{id(x)}' + main('let x=42;println!("{}",*forward(&x));'), '42\n'],
  ['recursive signature contract', 'fn find(x:&i32,n:i32)->&i32{if n==0{x}else{find(x,n-1)}}' + main('let x=42;println!("{}",*find(&x,4));'), '42\n'],
  ['recursive mutable contract', 'fn find(x:&mut i32,n:i32)->&mut i32{if n==0{x}else{find(x,n-1)}}' + main('let mut x=0;let r=find(&mut x,4);*r=42;println!("{}",x);'), '42\n'],
  ['early explicit return validates origin', shared + 'fn forward(x:&i32)->&i32{if true{return id(x);}x}' + main('let x=42;println!("{}",*forward(&x));'), '42\n'],
  ['conditional result joins call loans', shared + main('let x=20;let y=42;let r=if false{id(&x)}else{id(&y)};println!("{}",*r);'), '42\n'],
  ['match result joins call loans', shared + main('let x=20;let y=42;let r=match 0{0=>id(&y),_=>id(&x)};println!("{}",*r);'), '42\n'],
  ['label result retains call loan', shared + main("let x=42;let r='a:{break 'a id(&x);};println!(\"{}\",*r);"), '42\n'],
  ['loop result retains call loan', shared + main('let x=42;let r=loop{break id(&x);};println!("{}",*r);'), '42\n'],
  ['let chain binds call result', shared + main('let x=42;if let r=id(&x) && *r>0{println!("{}",*r);}'), '42\n'],
  ['let chain returns call result', shared + main('let x=42;let r=if let n=1 && n>0{id(&x)}else{&x};println!("{}",*r);'), '42\n'],
  ['scoped handle does not shorten returned referent', shared + main('let x=42;let r={let s=&x;id(s)};println!("{}",*r);'), '42\n'],
  ['outer assignment retains returned loan', shared + main('let x=42;let y=0;let mut r=&y;{r=id(&x);}println!("{}",*r);'), '42\n'],
  ['loop-local returned loan expires between iterations', unique + main('let mut x=0;for n in 0..3{let r=id(&mut x);*r+=14;}println!("{}",x);'), '42\n'],
  ['backedge uses returned shared reference', shared + main('let x=42;let r=id(&x);for n in 0..2{println!("{}",*r);}'), '42\n42\n'],
  ['generic identity carries type lifetime', 'fn same<T>(x:T)->T{x}' + main('let x=42;let r=same(&x);println!("{}",*r);'), '42\n'],
  ['generic identity moves unique handle', 'fn same<T>(x:T)->T{x}' + main('let mut x=0;let r=&mut x;let s=same(r);*s=42;println!("{}",x);'), '42\n'],
  ['generic selection constrains all matching inputs', 'fn choose<T>(x:T,y:T,flag:bool)->T{if flag{x}else{y}}' + main('let x=20;let y=42;let r=choose(&x,&y,false);println!("{}",*r);'), '42\n'],
  ['generic identity excludes unrelated elided input', 'fn same<T>(x:T,ignored:&i32)->T{x}' + main('let x=42;let r={let y=1;same(&x,&y)};println!("{}",*r);'), '42\n'],
  ['generic alias identity', 'type Alias<T> = T;fn same<T>(x:Alias<T>)->Alias<T>{x}' + main('let x=42;println!("{}",*same(&x));'), '42\n'],
  ['alias reference signature', 'type Ref<T> = T;fn alias(x:Ref<&i32>)->Ref<&i32>{x}' + main('let x=42;println!("{}",*alias(&x));'), '42\n'],
  ['generic shared method returns projected reference', item + main('let c=Cell{value:42};println!("{}",*c.get());'), '42\n'],
  ['generic mutable method returns projected reference', item + main('let mut c=Cell{value:0};let r=c.get_mut();*r=42;println!("{}",c.value);'), '42\n'],
  ['method receiver lifetime wins over other argument', 'struct S{i:i32}impl S{fn get(&self,_other:&i32)->&i32{&self.i}}' + main('let s=S{i:42};let r={let n=0;s.get(&n)};println!("{}",*r);'), '42\n'],
  ['returned reference receiver', 'struct C;fn id(x:&C)->&C{x}impl C{fn answer(&self)->i32{42}}' + main('let c=C;println!("{}",id(&c).answer());'), '42\n'],
  ['returned mutable reference receiver', 'struct C{n:i32}fn id(x:&mut C)->&mut C{x}impl C{fn set(&mut self){self.n=42}}' + main('let mut c=C{n:0};id(&mut c).set();println!("{}",c.n);'), '42\n'],
  ['trait method elided reference result', 'trait Get{fn get(&self)->&i32;}struct C(i32);impl Get for C{fn get(&self)->&i32{&self.0}}fn read<T:Get>(x:&T)->i32{*x.get()}' + main('let c=C(42);println!("{}",read(&c));'), '42\n'],
  ['qualified method call carries receiver contract', item + main('let c=Cell{value:42};println!("{}",*Cell::<i32>::get(&c));'), '42\n'],
  ['function item reference result', shared + main('let f=id;let x=42;println!("{}",*f(&x));'), '42\n'],
  ['function pointer reference result', shared + main('let f:fn(&i32)->&i32=id;let x=42;println!("{}",*f(&x));'), '42\n'],
  ['function pointer mutable reborrow', unique + main('let f:fn(&mut i32)->&mut i32=id;let mut x=0;let r=&mut x;let s=f(r);*s=20;*r+=22;println!("{}",x);'), '42\n'],
  ['generic method item', item + main('let f=Cell::<i32>::get;let c=Cell{value:42};println!("{}",*f(&c));'), '42\n'],
  ['ordinary argument reborrow does not move handle', put + main('let mut x=0;let r=&mut x;put(r,20);put(r,42);println!("{}",*r);'), '42\n'],
  ['mutable argument uses two phase activation', put + main('let mut x=20;let r=&mut x;put(r,*r+22);println!("{}",*r);'), '42\n'],
  ['function pointer argument uses two phase activation', put + main('let f:fn(&mut i32,i32)=put;let mut x=20;let r=&mut x;f(r,*r+22);println!("{}",*r);'), '42\n'],
  ['function item argument uses two phase activation', put + main('let f=put;let mut x=20;let r=&mut x;f(r,*r+22);println!("{}",*r);'), '42\n'],
  ['shared formal never inherits mutable input type', 'fn read(x:&i32)->i32{*x}' + main('let mut x=42;let r=&mut x;println!("{}",read(r));*r=0;'), '42\n'],
  ['shared return from unique input retains original unique lifetime', 'fn view(x:&mut i32)->&i32{&*x}' + main('let mut x=42;let r=&mut x;let s=view(r);println!("{}",*s);*r=0;'), '42\n'],
  ['argument side effects occur exactly once', 'fn index()->usize{println!("index");0}' + unique + main('let mut a=[0];let r=id(&mut a[index()]);*r=42;println!("{}",a[0]);'), 'index\n42\n'],
  ['result used only in one branch does not block another', shared + main('let mut x=20;let r=id(&x);if false{println!("{}",*r);}else{x=42;}println!("{}",x);'), '42\n'],
  ['shared reference copied through nested pointer storage', 'fn keep<T>(x:&T)->&T{x}' + main('let x=42;let y=&x;let r=keep(&y);let z=*r;println!("{}",*z);'), '42\n'],
  ['generic return alias excludes unrelated unique argument', 'fn same<T>(x:T,ignored:&mut i32)->T{x}' + main('let x=42;let mut n=0;let r=same(&x,&mut n);n=1;println!("{}",*r);'), '42\n'],
];
export const borrowContractCompileFailCases = [
  ['mutation while shared call result live', shared + main('let mut x=0;let r=id(&x);x=1;println!("{}",*r);'), 'E0502'],
  ['mutation while unique call result live', unique + main('let mut x=0;let r=id(&mut x);x=1;println!("{}",*r);'), 'E0502'],
  ['read while unique call result live', unique + main('let mut x=0;let r=id(&mut x);println!("{} {}",x,*r);'), 'E0503'],
  ['conflicting second call', unique + main('let mut x=0;let a=id(&mut x);let b=id(&mut x);println!("{} {}",*a,*b);'), 'E0502'],
  ['nested result freezes original', unique + main('let mut x=0;let r=&mut x;let s=id(id(r));*r=1;println!("{}",*s);'), 'E0502'],
  ['call result copy keeps shared loan', shared + main('let mut x=0;let a=id(&x);let b=a;println!("{}",*a);x=1;println!("{}",*b);'), 'E0502'],
  ['generic identity keeps input loan', 'fn same<T>(x:T)->T{x}' + main('let mut x=0;let r=same(&x);x=1;println!("{}",*r);'), 'E0502'],
  ['generic argument still moves mutable handle', 'fn same<T>(x:T)->T{x}' + main('let mut x=0;let r=&mut x;let s=same(r);*s=1;*r=2;'), 'E0382'],
  ['generic selector retains both input lifetimes', 'fn choose<T>(x:T,y:T)->T{x}' + main('let mut x=0;let mut y=1;let r=choose(&x,&y);y=2;println!("{}",*r);'), 'E0502'],
  ['forwarding call retains loan', shared + 'fn forward(x:&i32)->&i32{id(x)}' + main('let mut x=0;let r=forward(&x);x=1;println!("{}",*r);'), 'E0502'],
  ['function pointer result retains loan', shared + main('let f:fn(&i32)->&i32=id;let mut x=0;let r=f(&x);x=1;println!("{}",*r);'), 'E0502'],
  ['function item result retains loan', shared + main('let f=id;let mut x=0;let r=f(&x);x=1;println!("{}",*r);'), 'E0502'],
  ['method contract borrows whole receiver despite returned field', pair + main('let mut p=Pair{left:0,right:0};let r=p.left();p.right=1;*r=2;'), 'E0502'],
  ['generic method freezes receiver', item + main('let mut c=Cell{value:0};let r=c.get();c.value=1;println!("{}",*r);'), 'E0502'],
  ['returned mutable operand remains protected in enclosing call', unique + 'fn use_it(x:&mut i32,n:i32){}' + main('let mut x=0;use_it(id(&mut x),{x=1;0});'), 'E0502'],
  ['explicit argument borrow is not two phase', put + main('let mut x=0;let r=&mut x;put(&mut *r,*r+1);'), 'E0503'],
  ['two phase activation rejects a conflicting live shared argument', 'fn both(x:&mut i32,y:&i32){}' + main('let mut x=0;let r=&mut x;both(r,&*r);'), 'E0502'],
  ['two phase reservation rejects a second mutation', put + main('let mut x=0;let r=&mut x;put(r,{*r=1;2});'), 'E0502'],
  ['shared formal cannot mutate unique actual', 'fn wrong(x:&i32){*x=1;}' + main('let mut x=0;wrong(&mut x);'), 'E0594'],
  ['shared result from unique input preserves unique loan', 'fn view(x:&mut i32)->&i32{&*x}' + main('let mut x=0;let r=view(&mut x);println!("{} {}",x,*r);'), 'E0503'],
  ['block-local call referent cannot escape', shared + main('let r={let x=1;id(&x)};println!("{}",*r);'), 'E0597'],
  ['temporary block argument cannot escape', shared + main('let r=id({let x=1;&x});println!("{}",*r);'), 'E0597'],
  ['outer assignment cannot extend local lifetime', shared + main('let y=0;let mut r=&y;{let x=1;r=id(&x);}println!("{}",*r);'), 'E0597'],
  ['returned shared reference keeps originating loan across nested handle scope', shared + main('let mut x=0;let r={let a=&x;id(a)};x=1;println!("{}",*r);'), 'E0502'],
  ['loop result cannot extend local lifetime', shared + main('let r=loop{let x=1;break id(&x);};println!("{}",*r);'), 'E0597'],
  ['returned reference lives across loop backedge', shared + main('let mut x=0;let r=id(&x);for n in 0..2{println!("{}",*r);x=1;}'), 'E0502'],
  ['if alternative result retains possible origins', shared + main('let mut x=0;let mut y=1;let r=if true{id(&x)}else{id(&y)};y=2;println!("{}",*r);'), 'E0502'],
  ['condition binding call cannot lose origin', shared + main('let mut x=0;if let r=id(&x) && true{x=1;println!("{}",*r);}'), 'E0502'],
  ['returning local via helper is rejected', shared + 'fn wrong(p:&i32)->&i32{let x=1;id(&x)}' + main('let n=0;wrong(&n);'), 'E0515'],
  ['condition return local through call is rejected', shared + 'fn wrong(p:&i32)->&i32{if let x=1 && true{id(&x)}else{p}}' + main('let n=0;wrong(&n);'), 'E0597'],
  ['receiver cannot return unrelated argument lifetime', 'struct S;impl S{fn wrong(&self,other:&i32)->&i32{other}}' + main('let s=S;let n=0;s.wrong(&n);'), 'E0623'],
  ['ambiguous free function output lifetime', 'fn wrong(x:&i32,y:&i32)->&i32{x}' + main('let x=0;let y=1;wrong(&x,&y);'), 'E0106'],
  ['missing input lifetime', 'fn wrong()->&i32{let x=0;&x}' + main('wrong();'), 'E0106'],
  ['nested elided input lifetimes are ambiguous', 'fn wrong(x:&&i32)->&i32{*x}' + main('let x=0;let y=&x;wrong(&y);'), 'E0106'],
  ['nested pointer copy retains inner referent loan', 'fn keep<T>(x:&T)->&T{x}' + main('let mut x=0;let y=&x;let r=keep(&y);let z=*r;x=1;println!("{}",*z);'), 'E0502'],
];

borrowContractCases.push(["nested last use", "fn keep<T>(x:&T)->&T{x}fn main(){let mut x=20;let y=&x;let r=keep(&y);let z=*r;println!(\"{}\",*z);x=42;println!(\"{}\",x);}", "20\n42\n"]);

borrowContractCases.push(["three reference layers", "fn keep<T>(x:&T)->&T{x}fn main(){let x=42;let y=&x;let r=&y;let z=keep(&r);println!(\"{}\",***z);}", "42\n"]);

borrowContractCompileFailCases.push(["three reference layers conflict", "fn keep<T>(x:&T)->&T{x}fn main(){let mut x=0;let y=&x;let r=&y;let z=keep(&r);x=1;println!(\"{}\",***z);}", "E0502"]);

borrowContractCompileFailCases.push(["nested origin survives copied result", "fn keep<T>(x:&T)->&T{x}fn main(){let mut x=0;let y=&x;let r=keep(&y);let c=r;let z=*c;x=1;println!(\"{}\",*z);}", "E0502"]);

borrowContractCompileFailCases.push(["nested backedge", "fn keep<T>(x:&T)->&T{x}fn main(){let mut x=0;let y=&x;let r=keep(&y);for n in 0..2{println!(\"{}\",**r);x=1;}}", "E0502"]);

borrowContractCases.push(["nested use only other branch", "fn keep<T>(x:&T)->&T{x}fn main(){let mut x=20;let y=&x;let r=keep(&y);if false{println!(\"{}\",**r);}else{x=42;}println!(\"{}\",x);}", "42\n"]);

borrowContractCompileFailCases.push(["nested pointer storage frozen", "fn keep<T>(x:&T)->&T{x}fn main(){let x=0;let z=1;let mut y=&x;let r=keep(&y);y=&z;println!(\"{}\",**r);}", "E0502"]);

borrowContractCases.push(["dereferenced shared copy independent storage", "fn keep<T>(x:&T)->&T{x}fn main(){let x=42;let z=0;let mut y=&x;let r=keep(&y);let s=*r;y=&z;println!(\"{} {}\",*s,*y);}", "42 0\n"]);

// Finite differential matrix: every pair of four nested scalar projections,
// both input-loan mutabilities, and conflicting versus disjoint mutation.
// The callee is opaque at the call site; only the explicit argument place may
// narrow the retained borrow. No code is executed to manufacture an expectation.
const projectedPaths = ['0.0', '0.1', '1.0', '1.1'];
for (const mutable of [false, true]) for (const borrowed of projectedPaths) for (const written of projectedPaths) {
  const name = `returned ${mutable ? 'unique' : 'shared'} projection ${borrowed} versus mutation ${written}`;
  const source = (mutable ? unique : shared) + main(`let mut p=((1,2),(3,4));let r=id(&${mutable ? 'mut ' : ''}p.${borrowed});p.${written}=42;println!("{} {}",*r,p.${written});`);
  if (borrowed === written) borrowContractCompileFailCases.push([name, source, 'E0502']);
  else borrowContractCases.push([name, source, `${projectedPaths.indexOf(borrowed) + 1} 42\n`]);
}

// T's lifetime is shared even when another parameter stores it behind one or
// more reference layers. The selected body must never narrow that contract.
for (const depth of [1, 2, 3]) for (const from of ['direct', 'indirect']) {
  const signature = `fn choose<T:Copy>(x:T,y:${'&'.repeat(depth)}T)->T{${from === 'direct' ? 'x' : '*'.repeat(depth) + 'y'}}`;
  const chain = Array.from({length: depth - 1}, (_, i) => `let s${i}=&${i === 0 ? 'bref' : `s${i - 1}`};`).join('');
  const argument = `&${depth === 1 ? 'bref' : `s${depth - 2}`}`, value = from === 'direct' ? 42 : 7;
  const name = `generic ${from} result with ${depth} indirect input layers`;
  borrowContractCases.push(
    [name, signature + main(`let a=42;let b=7;let bref=&b;${chain}let r=choose(&a,${argument});println!("{}",*r);`), `${value}\n`],
    [`${name} releases after use`, signature + main(`let a=42;let mut b=7;let bref=&b;${chain}let r=choose(&a,${argument});println!("{}",*r);b=9;println!("{}",b);`), `${value}\n9\n`],
    [`${name} does not retain pointer storage`, signature + main(`let a=42;let b=7;let c=8;let mut bref=&b;${chain}let r=choose(&a,${argument});bref=&c;println!("{} {}",*r,*bref);`), `${value} 8\n`],
  );
  borrowContractCompileFailCases.push(
    [`${name} cannot escape`, signature + main(`let a=42;let r={let b=7;let bref=&b;${chain}choose(&a,${argument})};println!("{}",*r);`), 'E0597'],
    [`${name} prevents mutation`, signature + main(`let a=42;let mut b=7;let bref=&b;${chain}let r=choose(&a,${argument});b=9;println!("{}",*r);`), 'E0502'],
  );
}
borrowContractCases.push(
  ['indirect generic result outlives temporary input storage', 'fn copy<T:Copy>(x:&T)->T{*x}' + main('let a=42;let r={let s=&a;copy(&s)};println!("{}",*r);'), '42\n'],
  ['generic copy through mutable storage releases outer loan', 'fn copy<T:Copy>(x:&mut T)->T{*x}' + main('let a=42;let b=7;let mut s=&a;let r=copy(&mut s);s=&b;println!("{} {}",*r,*s);'), '42 7\n'],
  ['indirect generic dependency through transparent alias', 'type Value<T>=T;fn copy<T:Copy>(x:&Value<T>)->Value<T>{*x}' + main('let a=42;let b=&a;let r=copy(&b);println!("{}",*r);'), '42\n'],
  ['unique generic result releases indirect input after use', 'fn choose<T>(x:T,y:&T)->T{x}' + main('let mut a=42;let mut b=7;let y=&mut b;let r=choose(&mut a,&y);*r+=1;println!("{}",*r);b=9;println!("{}",b);'), '43\n9\n'],
  ['scalar generic nested result needs no extra regions', 'fn choose<T>(x:&T,y:T)->&T{x}' + main('let a=42;let r=choose(&a,7);println!("{}",*r);'), '42\n'],
);
borrowContractCompileFailCases.push(
  ['generic copy through mutable storage retains inner loan', 'fn copy<T:Copy>(x:&mut T)->T{*x}' + main('let mut a=42;let b=7;let mut s=&a;let r=copy(&mut s);s=&b;a=0;println!("{} {}",*r,*s);'), 'E0502'],
  ['unique generic result retains indirect input lifetime', 'fn choose<T>(x:T,y:&T)->T{x}' + main('let mut a=42;let mut b=7;let y=&mut b;let r=choose(&mut a,&y);b=9;println!("{}",*r);'), 'E0502'],
);
