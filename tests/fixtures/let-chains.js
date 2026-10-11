/** Exact source shared by the browser backends and the native edition-2024 oracle. */
export const letChainCases = [
  ['let chain: sequential pattern and boolean operands', `fn main(){if let Some(x)=Some(7) && let y=x+1 && y>7 {println!("{}",y);}}`, '8\n'],
  ['let chain: boolean prefix and grouped disjunction', `fn main(){if (false||true) && let Some(x)=Some(4) && (x==4||false){println!("{}",x);}}`, '4\n'],
  ['let chain: pattern alternatives', `fn main(){let x:Result<i32,i32>=Err(7);if let Ok(n)|Err(n)=x && n>0{println!("{}",n);}}`, '7\n'],
  ['let chain: range and at patterns', `fn main(){if let n@2..=8=7 && n<8{println!("{}",n);}}`, '7\n'],
  ['let chain: repeated shadowing has ordered scope', `fn main(){let x=2;if let x=x+1 && let x=x*3 && x==9 {println!("{}",x);}println!("{}",x);}`, '9\n2\n'],
  ['let chain: else uses outer scope', `fn main(){let x=2;if let Some(x)=None::<i32> && x==9 {println!("{}",x);}else{println!("{}",x);}}`, '2\n'],
  ['let chain: first false skips all effects', `fn source()->Option<i32>{println!("source");Some(7)}fn main(){if false && let Some(n)=source(){println!("{}",n);}else{println!("else");}}`, 'else\n'],
  ['let chain: failed pattern skips following expressions', `fn first()->Option<i32>{println!("first");None}fn next()->i32{println!("next");2}fn main(){if let Some(n)=first() && let m=next() && n<m {println!("yes");}else{println!("else");}}`, 'first\nelse\n'],
  ['let chain: scrutinees and else are evaluated once', `fn first()->Option<i32>{println!("first");Some(4)}fn second(n:i32)->Option<i32>{println!("second {}",n);None}fn main(){if let Some(a)=first() && let Some(b)=second(a) && b>0 {println!("yes");}else{println!("else");}}`, 'first\nsecond 4\nelse\n'],
  ['let chain: expression result and else if', `fn main(){let n=if let Some(a)=Some(4) && a<0 {a}else if let Some(b)=Some(8) && b>4{b}else{0};println!("{}",n);}`, '8\n'],
  ['let chain: tuple record and array rest patterns', `struct S{a:i32,b:i32}fn main(){if let (x,y)=(2,3) && let S{a,b}= (S{a:x,b:y}) && let [first,rest@..]=[a,b,4] && rest[1]==4{println!("{} {}",first,rest[0]);}}`, '2 3\n'],
  ['let chain: constants in patterns', `const LIMIT:i32=7;fn main(){if let LIMIT=7 && let n=LIMIT+1{println!("{}",n);}}`, '8\n'],
  ['let chain: copy aggregate materialization is independent', `fn main(){let a=[1,2];if let mut b=a && {b[0]=9;true}{println!("{} {}",a[0],b[0]);}}`, '1 9\n'],
  ['let chain: wildcard does not move scrutinee', `fn main(){let s=Some(String::from("x"));if let Some(_)=s && true {}println!("{}",s.unwrap());}`, 'x\n'],
  ['let chain: copy-only projections preserve whole aggregate', `struct S{n:i32,text:String}fn main(){let s=S{n:7,text:String::from("x")};if let S{n,..}=s && n>0{println!("{} {}",n,s.text);}}`, '7 x\n'],
  ['let chain: moved success value and reinitialized failure state', `fn main(){let mut s=String::from("x");if let t=s && false {println!("{}",t);s=String::from("z");}else{s=String::from("y");}println!("{}",s);}`, 'y\n'],
  ['let chain: generic Copy evidence', `fn show<T:Copy+std::fmt::Display>(x:T){if let y=x && true{let a=y;let b=y;println!("{} {}",a,b);}}fn main(){show(7);}`, '7 7\n'],
  ['let chain: associated Copy evidence', `trait S{type Item:Copy+std::fmt::Display;}struct X;impl S for X{type Item=i32;}fn show<T:S>(x:T::Item){if true && let y=x {let a=y;let b=y;println!("{} {}",a,b);}}fn main(){show::<X>(7);}`, '7 7\n'],
  ['let chain: generic result retains abstract method dispatch', `trait Tag{fn tag(self)->i32;}struct X;impl Tag for X{fn tag(self)->i32{7}}impl X{fn tag(self)->i32{99}}fn f<T:Tag>(x:T)->i32{let y=if let n=x && true{n}else{panic!("no")};y.tag()}fn main(){println!("{}",f(X));}`, '7\n'],
  ['let chain: closure scopes do not capture pattern names', `fn main(){let x=2;let f=||{if let x=x+1 && let y=x*2 && y>0{y}else{x}};println!("{} {}",f(),x);}`, '6 2\n'],
  ['let chain: moved closure result', `fn main(){let x=7;if let f=(move ||x) && f()>0{println!("{}",f());}}`, '7\n'],
  ['let chain: nested closure captures a successful binding', `fn main(){let f=if let x=7 && true{move ||x}else{panic!("no")};println!("{}",f());}`, '7\n'],
  ['let chain: while re-evaluates bindings', `fn main(){let mut n=0;while n<3 && let x=n+1 && x<4 {n=x;println!("{}",n);}}`, '1\n2\n3\n'],
  ['let chain: while pattern terminates', `fn main(){let mut a=vec![1,2,3];while let Some(n)=a.pop() && n>1 {println!("{}",n);}println!("{}",a.len());}`, '3\n2\n0\n'],
  ['let chain: body continue returns to header', `fn main(){let mut n=0;while n<4 && let x=n {n+=1;if x==1{continue;}println!("{}",x);}}`, '0\n2\n3\n'],
  ['let chain: break in condition targets current loop', `fn main(){'w:while let n=7 && {println!("{}",n);break 'w;} {println!("no");}println!("done");}`, '7\ndone\n'],
  ['let chain: continue in condition re-enters current header', `fn main(){let mut n=0;'w:while n<3 && let x={n+=1;if n<3{continue 'w;}n} && x==3{println!("{}",x);}}`, '3\n'],
  ['let chain: labelled nested control', `fn main(){let mut n=0;'outer:while n<4 && let x=n {n+=1;while let y=x && true {if y==1{continue 'outer;}println!("{}",y);break;}if n==3{break 'outer;}}}`, '0\n2\n'],
  ['let chain: while consuming once with break', `fn main(){let s=String::from("x");while true && let t=s {println!("{}",t);break;}}`, 'x\n'],
  ['let chain: while reinitialization before backedge', `fn main(){let mut s=String::from("x");let mut n=0;while n<2 && let t=s {println!("{}",t);s=String::from("y");n+=1;}}`, 'x\ny\n'],
  ['let chain: header reinitialization before consumption', `fn main(){let mut s=String::from("initial");let mut n=0;while n<2 && let t={s=String::from("x");s} {n+=1;println!("{}",t);}}`, 'x\nx\n'],
  ['let chain: reference binding loan ends before else', `fn main(){let mut n=7;if let r=&n && false {println!("{}",*r);}else{n+=1;}println!("{}",n);}`, '8\n'],
  ['let chain: mutable reference binding', `fn main(){let mut n=7;if let r=&mut n && *r>0 {*r+=1;}println!("{}",n);}`, '8\n'],
  ['let chain: pointer result keeps outer referent', `fn main(){let n=7;let r=if true && let q=&n {q}else{&n};println!("{}",*r);}`, '7\n'],
  ['let chain: return reference parameter', `fn f(n:&i32)->&i32{if let r=n && *r>0{r}else{n}}fn main(){let n=7;let r=f(&n);println!("{}",*r);}`, '7\n'],
  ['let chain: while local loan is renewed per iteration', `fn main(){let mut n=0;while n<3 && let r=&mut n && *r<3 {*r+=1;}println!("{}",n);}`, '3\n'],
  ['let chain: const if and while use ordinary checked MIR', `const fn f()->i32{let mut n=0;while n<3 && let x=n+1{n=x;}if let (a,b)=(n,4) && a<b{a+b}else{0}}const N:i32=f();fn main(){println!("{}",N);}`, '7\n'],
  ['let chain: inline const and repeat count', `fn main(){let a=[7;const{if let n=3usize && n>0{n}else{0}}];println!("{} {}",a.len(),a[2]);}`, '3 7\n'],
  ['let chain: short circuit skips panicking runtime and const operands', `const N:i32=if false && let n=1/0{n}else{7};fn main(){if false && let n=1/0{println!("{}",n);}println!("{}",N);}`, '7\n'],
  ['let chain: early return in scrutinee', `fn f()->i32{if true && let _={return 7;} && true{0}else{1}}fn main(){println!("{}",f());}`, '7\n'],
  ['let chain: boolean condition can contain nested chain', `fn main(){if let x=3 && (if let y=4 && y>x{true}else{false}) {println!("{}",x);}}`, '3\n'],
];

export const letChainCompileFailCases = [
  ['let chain: unlabeled break in while condition', 'fn main(){while let n=7 && {break;}{}}', 'E0590'],
  ['let chain: unlabeled continue in while condition', 'fn main(){while let n=7 && {continue;}{}}', 'E0590'],
  ['let chain: reinitialization on only one branch is insufficient', 'fn main(){let mut s=String::from("x");if let t=s && false {}else{s=String::from("y");}println!("{}",s);}', 'E0382'],
  ['let chain: closure body does not end at condition conjunction', 'fn main(){let x=7;if let f=move ||x && f()>0{}}', 'E0425'],
  ['let chain: different capturing closures cannot join', 'fn main(){let f=if let x=7 && true{move ||x}else{move ||0};}', 'E0308'],
  ['let chain: unreachable operands remain type checked', 'fn f()->i32{if true && let x={return 7;} && x==0{0}else{1}}fn main(){f();}', 'E0308'],
  ['let chain: let expression outside a condition', 'fn main(){let b=let x=1;}', 'E0003'],
  ['let chain: parenthesized let is not a boolean', 'fn main(){if (let x=1) && true{}}', 'E0003'],
  ['let chain: disjunction following let', 'fn main(){if let x=1 || true{}}', 'E0003'],
  ['let chain: disjunction preceding let', 'fn main(){if false || let x=1{}}', 'E0003'],
  ['let chain: mixed conjunction and disjunction', 'fn main(){if false || true && let x=1{}}', 'E0003'],
  ['let chain: nested let in a comparison', 'fn main(){if true == let x=1{}}', 'E0003'],
  ['let chain: non-boolean condition operand', 'fn main(){if let x=1 && x{}}', 'E0308'],
  ['let chain: pattern scrutinee type mismatch', 'fn main(){if let Some(x)=7 && x>0{}}', 'E0532'],
  ['let chain: later name is not visible earlier', 'fn main(){if x>0 && let x=7{}}', 'E0425'],
  ['let chain: binding is not visible in else', 'fn main(){if let x=7 && false {}else{println!("{}",x);}}', 'E0425'],
  ['let chain: binding is not visible after if', 'fn main(){if let x=7 && true {}println!("{}",x);}', 'E0425'],
  ['let chain: binding is not visible after while', 'fn main(){while let x=7 && false {}println!("{}",x);}', 'E0425'],
  ['let chain: immutable pattern local', 'fn main(){if let x=7 && true {x=8;}}', 'E0596'],
  ['let chain: duplicate pattern bindings', 'fn main(){if let (x,x)=(1,2) && true{}}', 'E0416'],
  ['let chain: moved scrutinee after chain', 'fn main(){let s=String::from("x");if true && let t=s {println!("{}",t);}println!("{}",s);}', 'E0382'],
  ['let chain: later failure preserves earlier move', 'fn main(){let s=String::from("x");if let t=s && false {}else{println!("{}",s);}}', 'E0382'],
  ['let chain: false prefix does not bypass static ownership', 'fn main(){let s=String::from("x");if false && let t=s {}println!("{}",s);}', 'E0382'],
  ['let chain: generic concrete Copy does not grant abstract Copy', 'fn f<T>(x:T){if let y=x && true{let a=y;let b=y;}}fn main(){f(7);}', 'E0382'],
  ['let chain: repeated outer move on loop backedge', 'fn main(){let s=String::from("x");while true && let t=s {println!("{}",t);}}', 'E0382'],
  ['let chain: continue can skip reinitialization', 'fn main(){let mut s=String::from("x");let mut n=0;while n<3 && let t=s{n+=1;if n==1{continue;}s=String::from("y");}}', 'E0382'],
  ['let chain: outer move on header continue edge', `fn main(){let s=String::from("x");'w:while true && let t=s && {continue 'w;}{}}`, 'E0382'],
  ['let chain: borrowing blocks mutation in next condition', 'fn main(){let mut n=7;if let r=&n && {n+=1;true}{println!("{}",*r);}}', 'E0502'],
  ['let chain: mutable condition loan blocks direct access', 'fn main(){let mut n=7;if let r=&mut n && n>0{println!("{}",*r);}}', 'E0503'],
  ['let chain: return condition-local referent', 'fn f(p:&i32)->&i32{if let n=7 && true{&n}else{p}}fn main(){}', 'E0597'],
  ['let chain: scrutinee local referent escapes', 'fn main(){if let r={let n=7;&n} && true{println!("{}",*r);}}', 'E0597'],
  ['let chain: non-Copy move out of reference', 'fn main(){let s=String::from("x");let r=&s;if let t=*r && true {println!("{}",t);}}', 'E0507'],
  ['let chain: whole and non-Copy part cannot both move', 'fn main(){let s=Some(String::from("x"));if let whole@Some(part)=s && true {}}', 'E0382'],
  ['let chain: non-const call remains invalid in skipped operand', 'fn f()->i32{7}const N:i32=if false && let n=f(){n}else{0};fn main(){}', 'E0015'],
];

export const letChainPanicCases = [
  ['let chain: evaluated operand panics once', 'fn main(){if let n=7 && {println!("{}",n);panic!("stop");}{}}', 'R_PANIC', '7\n'],
  ['let chain: evaluated scrutinee overflow', 'fn main(){if true && let n=255u8+1{println!("{}",n);}}', 'R_OVERFLOW', ''],
  ['let chain: while header panic preserves earlier iterations', 'fn main(){let mut n=0;while n<3 && let x={if n==2{panic!("stop");}n}{println!("{}",x);n+=1;}}', 'R_PANIC', '0\n1\n'],
];

letChainCases.push(
  ['let chain: inner loop permits unlabeled header-block exit', `fn main(){while let x=7 && {loop{break;}false} {println!("{}",x);}println!("done");}`, 'done\n'],
  ['let chain: return from header does not enter body', `fn f()->i32{'w:while let _={return 7;} && true {}0}fn main(){println!("{}",f());}`, '7\n'],
  ['let chain: reference used only by later condition permits body mutation', `fn main(){let mut n=7;if let r=&n && *r>0{n+=1;}println!("{}",n);}`, '8\n'],
  ['let chain: existing shared reference binding', `fn main(){let n=7;let r=&n;if let q=r && *q>0 {println!("{} {}",*q,*r);}}`, '7 7\n'],
  ['let chain: borrow-only closure can repeat wildcard chain', `fn main(){let s=Some(String::from("x"));let f=||{if let Some(_)=s && true {7}else{0}};println!("{} {}",f(),f());println!("{}",s.unwrap());}`, '7 7\nx\n'],
  ['let chain: noncapturing callable branches', `fn a()->i32{7}fn b()->i32{8}fn main(){let f=if let x=7 && x>0{a}else{b};println!("{}",f());}`, '7\n'],
  ['let chain: associated constant scrutinee', `struct S;impl S{const N:Option<i32>=Some(7);}fn main(){if let Some(x)=S::N && x>0{println!("{}",x);}}`, '7\n'],
  ['let chain: record enum and tuple projection', `enum E{V{x:i32,y:i32},N}fn main(){if let E::V{x,y}=(E::V{x:3,y:4}) && let (a,b)=(x,y) && a<b{println!("{} {}",a,b);}}`, '3 4\n'],
  ['let chain: question-mark condition exit', `fn f(n:Option<i32>)->Option<i32>{if let x=n? && x>0{Some(x)}else{None}}fn main(){println!("{} {}",f(Some(7)).unwrap(),f(None).is_none());}`, '7 true\n'],
);
letChainCompileFailCases.push(
  ['let chain: irrefutable else still rejects prior move', 'fn main(){let s=String::from("x");let t=s;if let x=1 && let y=2{}else{println!("{}",s);}}', 'E0382'],
  ['let chain: irrefutable else sees pattern move effects', 'fn main(){let s=String::from("x");if let x=s && let y=2{}else{println!("{}",s);}}', 'E0382'],
  ['let chain: irrefutable else move contributes to join', 'fn main(){let s=String::from("x");if let x=1 && let y=2{}else{let t=s;}println!("{}",s);}', 'E0382'],
  ['let chain: while exit joins conditional moves', 'fn main(){let s=String::from("x");while false && let x=s{break;}println!("{}",s);}', 'E0382'],
  ['let chain: reading before loop reinitialization fails', 'fn main(){let mut s=String::from("x");while true && let t=s{println!("{}",s);s=String::from("y");}}', 'E0382'],
  ['let chain: refutable failure after move retains whole-local restriction', 'fn main(){let v:Option<String>=None;if let Some(x)=v && x.len()>0{}else{println!("{}",v.is_none());}}', 'E0382'],
  ['let chain: mutable pointer cannot be copied into two bindings', 'fn main(){let mut n=7;let r=&mut n;if let a=r && let b=r{println!("{} {}",*a,*b);}}', 'E0382'],
  ['let chain: boolean operand block local does not leak', 'fn main(){if {let x=7;x>0} && let y=x{}}', 'E0425'],
  ['let chain: assignment requires a grouped boolean block', 'fn main(){let mut a=true;if let x=7 && a=false{}}', 'E0003'],
);

letChainCases.push(['let chain: documented complete program', `fn main() {
    let mut values = vec![1, 2, 3, 4];
    while let Some(value) = values.pop() && value > 1 {
        if let doubled = value * 2 && doubled > 4 {
            println!("{} {}", value, doubled);
        }
    }
}
`, '4 8\n3 6\n']);
