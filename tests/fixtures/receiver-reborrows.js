/** Reviewed Rust programs; native agreement is checked by language-conformance.mjs. */
const cell = 'struct C(i32);impl C{fn set(&mut self,x:i32){self.0=x;}fn get(&self)->i32{self.0}fn see(&self,x:i32)->i32{self.0+x}fn set_ref(&mut self,x:&C){self.0=x.0;}}';
export const receiverReborrowCases = [
  ['repeated mutable calls through a local reference', cell+'fn main(){let mut c=C(0);let r=&mut c;r.set(40);r.set(42);println!("{}",r.get());}', '42\n'],
  ['repeated mutable calls through a reference parameter', cell+'fn change(r:&mut C){r.set(41);r.set(42);}fn main(){let mut c=C(0);change(&mut c);println!("{}",c.0);}', '42\n'],
  ['shared method reborrow does not move mutable handle', cell+'fn main(){let mut c=C(40);let r=&mut c;println!("{}",r.get());r.set(42);println!("{}",r.get());}', '40\n42\n'],
  ['shared reference receiver remains reusable', cell+'fn main(){let c=C(42);let r=&c;println!("{} {}",r.get(),r.get());}', '42 42\n'],
  ['method receiver reference need not have a mutable binding', cell+'fn change(r:&mut C){r.set(42);}fn main(){let mut c=C(0);let r=&mut c;change(r);println!("{}",c.0);}', '42\n'],
  ['mutable method receiver survives loop back edges', cell+'fn change(r:&mut C){for i in 0..3{r.set(i);}}fn main(){let mut c=C(0);change(&mut c);println!("{}",c.0);}', '2\n'],
  ['two phase method receiver on an owned local', cell+'fn main(){let mut c=C(41);c.set(c.get()+1);println!("{}",c.0);}', '42\n'],
  ['two phase reborrow through mutable local reference', cell+'fn main(){let mut c=C(41);let r=&mut c;r.set(r.get()+1);println!("{}",r.get());}', '42\n'],
  ['two phase reborrow through mutable parameter', cell+'fn change(r:&mut C){r.set(r.get()+1);}fn main(){let mut c=C(41);change(&mut c);println!("{}",c.0);}', '42\n'],
  ['shared receiver nested calls release only inner loans', cell+'fn main(){let mut c=C(21);let r=&mut c;println!("{}",r.see(r.get()));r.set(42);println!("{}",r.get());}', '42\n42\n'],
  ['shared reference consumed before receiver activation', cell+'fn main(){let mut c=C(41);let r=&c;c.set(r.get()+1);println!("{}",c.0);}', '42\n'],
  ['disjoint receiver loans during nested calls', cell+'fn main(){let mut c=C(0);let d=C(41);let r=&mut c;let s=&d;r.set(s.get()+1);println!("{}",r.get());}', '42\n'],
  ['sequential mutable argument calls on disjoint locals', cell+'fn main(){let mut c=C(0);let mut d=C(1);let r=&mut c;let s=&mut d;r.set({s.set(42);s.get()});println!("{} {}",r.get(),s.get());}', '42 42\n'],
  ['temporary owned receiver with mutation materializes once', 'struct C(i32);fn make()->C{println!("make");C(41)}impl C{fn inc(&mut self)->i32{self.0+=1;self.0}}fn main(){println!("{}",make().inc());}', 'make\n42\n'],
  ['borrowed method on indexed place evaluates index once', '#[derive(Clone,Copy)]struct C(i32);impl C{fn set(&mut self,x:i32){self.0=x;}}fn index()->usize{println!("index");0}fn main(){let mut cs=[C(0)];cs[index()].set(42);println!("{}",cs[0].0);}', 'index\n42\n'],
  ['generic receiver reborrow preserves impl specialization', 'struct C<T>(T);impl<T:Copy>C<T>{fn set(&mut self,x:T){self.0=x;}fn get(&self)->T{self.0}}fn main(){let mut c=C(41);let r=&mut c;r.set(r.get()+1);println!("{}",r.get());let mut b=C(false);let s=&mut b;s.set(true);println!("{}",s.get());}', '42\ntrue\n'],
  ['mutable default reborrows preserve effective trait scope', 'trait Value{fn set(&mut self,x:i32);fn get(&self)->i32;fn inc(&mut self){self.set(self.get()+1);}}struct C(i32);impl Value for C{fn set(&mut self,x:i32){self.0=x;}fn get(&self)->i32{self.0}}fn main(){let mut c=C(41);let r=&mut c;r.inc();println!("{}",r.get());}', '42\n'],
  ['explicit nonoverlapping reference arguments remain valid', 'fn set(a:&mut i32,b:&mut i32){*a=20;*b=22;}fn main(){let mut a=0;let mut b=0;set(&mut a,&mut b);println!("{}",a+b);}', '42\n'],
];
export const receiverReborrowCompileFailCases = [
  ['mutable method rejects shared receiver authority', cell+'fn main(){let c=C(0);let r=&c;r.set(1);}', 'E0596'],
  ['shared receiver method body cannot inherit caller mutation authority', 'struct C(i32);impl C{fn bad(&self){self.0=1;}}fn main(){let mut c=C(0);let r=&mut c;r.bad();}', 'E0594'],
  ['moved mutable handle cannot be reborrowed', cell+'fn main(){let mut c=C(0);let r=&mut c;let s=r;r.set(1);}', 'E0382'],
  ['nested mutable call conflicts with reserved receiver', cell+'fn main(){let mut c=C(0);let r=&mut c;r.set({r.set(1);2});}', 'E0502'],
  ['assignment through reference conflicts with reserved receiver', cell+'fn main(){let mut c=C(0);let r=&mut c;r.set({*r=C(1);2});}', 'E0502'],
  ['underlying local assignment cannot bypass anonymous loan', cell+'fn main(){let mut c=C(0);let r=&mut c;r.set({c.0=1;2});}', 'E0502'],
  ['owned receiver reservation blocks argument mutation', cell+'fn main(){let mut c=C(0);c.set({c.0=1;2});}', 'E0502'],
  ['shared receiver blocks nested mutable activation', cell+'fn main(){let mut c=C(0);let r=&mut c;r.see({r.set(1);2});}', 'E0502'],
  ['reference argument conflicts at receiver activation', cell+'fn main(){let mut c=C(0);c.set_ref(&c);}', 'E0502'],
  ['live shared reference survives to activation', cell+'fn main(){let mut c=C(41);let r=&c;c.set(r.get()+1);println!("{}",r.0);}', 'E0502'],
  ['explicit mutable borrows are active while evaluating later arguments', 'fn pair(a:&mut i32,b:&mut i32){}fn main(){let mut x=0;pair(&mut x,&mut x);}', 'E0502'],
  ['explicit shared and mutable arguments remain incompatible', 'fn pair(a:&i32,b:&mut i32){}fn main(){let mut x=0;pair(&x,&mut x);}', 'E0502'],
  ['explicit mutable argument forbids later direct read', 'fn set(a:&mut i32,b:i32){*a=b;}fn main(){let mut x=0;set(&mut x,x);}', 'E0503'],
  ['explicit UFCS receiver is not a two phase borrow', cell+'fn main(){let mut c=C(41);C::set(&mut c,c.get()+1);}', 'E0503'],
];

export const receiverReborrowPanicCases = [
  ['borrowed receiver bounds are checked before arguments', 'struct C;impl C{fn set(&mut self,x:i32){println!("method");}}fn index()->usize{println!("index");2}fn argument()->i32{println!("argument");1}fn main(){let mut c=[C];c[index()].set(argument());}', 'R_BOUNDS', 'index\n'],
  ['receiver evaluated once before panicking argument', 'struct C;impl C{fn set(&mut self,x:i32){println!("method");}}fn index()->usize{println!("index");0}fn argument()->i32{println!("argument");panic!("expected")}fn main(){let mut c=[C];c[index()].set(argument());}', 'R_PANIC', 'index\nargument\n'],
];
