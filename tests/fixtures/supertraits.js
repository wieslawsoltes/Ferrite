const family = `mod api { pub trait Root { fn value(&self)->i32; fn create()->Self where Self:Sized; }
  pub trait Left: Root {} pub trait Right: Root {} pub trait Child: Left + Right {} }
struct Cell(i32); impl api::Root for Cell { fn value(&self)->i32{self.0} fn create()->Self{Cell(40)} }
impl api::Left for Cell {} impl api::Right for Cell {} impl api::Child for Cell {}`;
export const supertraitCases = [
  ['supertrait direct contract', 'trait A{fn a(&self)->i32;}trait B:A{fn b(&self)->i32{self.a()+1}}struct C;impl A for C{fn a(&self)->i32{1}}impl B for C{}fn main(){println!("{}",C.b());}', '2\n'],
  ['supertrait where Self syntax', 'trait A{}trait B where Self:A{}struct C;impl A for C{}impl B for C{}fn use_it<T:B>(_:T){}fn main(){use_it(C);}', ''],
  ['supertrait transitive Sized default', 'trait A:Sized{}trait B:A{fn same(self)->Self{self}}struct C;impl A for C{}impl B for C{}fn main(){let _:C=C.same();}', ''],
  ['supertrait builtin Clone implies Sized', 'trait A:Clone{fn same(self)->Self{self}}#[derive(Clone)]struct C;impl A for C{}fn main(){let _:C=C.same();}', ''],
  ['supertrait generic bound proves parent implementation', 'trait A{}trait B:A{}struct C<T>(T);impl<T:A>A for C<T>{}impl<T:B>B for C<T>{}struct Item;impl A for Item{}impl B for Item{}fn main(){let _=C(Item);}', ''],
  ['supertrait diamond resolves one inherited method', family+'fn read<T:api::Child>(item:T)->i32{item.value()}fn main(){println!("{}",read(Cell(3)));}', '3\n'],
  ['supertrait bound available through local alias', family+'fn read<T:api::Child>(item:T)->i32{let alias=item;alias.value()}fn main(){println!("{}",read(Cell(4)));}', '4\n'],
  ['supertrait generic bound beats inherent method', family+'impl Cell{fn value(&self)->i32{99}}fn read<T:api::Child>(item:T)->i32{item.value()}fn main(){println!("{} {}",read(Cell(5)),Cell(5).value());}', '5 99\n'],
  ['supertrait default inherited method beats inherent', 'mod p{pub trait A{fn a(&self)->i32;}}trait B:p::A{fn b(&self)->i32{self.a()}}struct C;impl p::A for C{fn a(&self)->i32{6}}impl C{fn a(&self)->i32{99}}impl B for C{}fn main(){println!("{} {}",C.b(),C.a());}', '6 99\n'],
  ['supertrait bound associated constructor', family+'fn make<T:api::Child>()->T{T::create()}fn main(){let c:Cell=make();println!("{}",c.0);}', '40\n'],
  ['supertrait bound associated function pointer', family+'fn make<T:api::Child>()->T{let f:fn()->T=T::create;f()}fn main(){let c:Cell=make();println!("{}",c.0);}', '40\n'],
  ['supertrait bounds do not alter concrete inherent precedence', family+'impl Cell{fn value(&self)->i32{99}}fn read<T:api::Child>(item:T)->i32{let a=item.value();a+Cell(0).value()}fn main(){println!("{}",read(Cell(7)));}', '106\n'],
  ['supertrait tuple projection carries bound', family+'fn read<T:api::Child>(item:(T,i32))->i32{item.0.value()+item.1}fn main(){println!("{}",read((Cell(8),2)));}', '10\n'],
  ['supertrait array element carries bound', family+'fn read<T:api::Child>(item:[T;1])->i32{item[0].value()}fn main(){println!("{}",read([Cell(9)]));}', '9\n'],
  ['supertrait record field carries bound', family+'struct Boxed<T>{item:T}fn read<T:api::Child>(item:Boxed<T>)->i32{item.item.value()}fn main(){println!("{}",read(Boxed{item:Cell(10)}));}', '10\n'],
  ['supertrait tuple pattern carries bound', family+'fn read<T:api::Child>(item:(T,i32))->i32{let (value,..)=item;value.value()}fn main(){println!("{}",read((Cell(11),0)));}', '11\n'],
  ['supertrait array pattern carries bound', family+'fn read<T:api::Child>(item:[T;1])->i32{let [value]=item;value.value()}fn main(){println!("{}",read([Cell(12)]));}', '12\n'],
  ['supertrait nominal pattern carries bound', family+'struct Boxed<T>(T);fn read<T:api::Child>(item:Boxed<T>)->i32{let Boxed(value)=item;value.value()}fn main(){println!("{}",read(Boxed(Cell(13))));}', '13\n'],
  ['supertrait if-let enum payload carries bound', family+'fn read<T:api::Child>(item:Option<T>)->i32{if let Some(value)=item{value.value()}else{0}}fn main(){println!("{}",read(Some(Cell(14))));}', '14\n'],
  ['supertrait match payload carries bound', family+'fn read<T:api::Child>(item:Option<T>)->i32{match item{Some(value)=>value.value(),None=>0}}fn main(){println!("{}",read(Some(Cell(15))));}', '15\n'],
  ['supertrait for element carries bound', family+'fn read<T:api::Child>(items:[T;1])->i32{let mut result=0;for item in items{result=item.value();}result}fn main(){println!("{}",read([Cell(16)]));}', '16\n'],
  ['supertrait generic function result carries bound', family+'fn identity<U>(value:U)->U{value}fn read<T:api::Child>(item:T)->i32{identity(item).value()}fn main(){println!("{}",read(Cell(17)));}', '17\n'],
  ['supertrait associated Self result carries bound', family+'fn read<T:api::Child>()->i32{T::create().value()}fn main(){println!("{}",read::<Cell>());}', '40\n'],
  ['supertrait block and if expression origins', family+'fn read<T:api::Child>(a:T,b:T)->i32{let value=if true{{a}}else{{b}};value.value()}fn main(){println!("{}",read(Cell(18),Cell(19)));}', '18\n'],
  ['supertrait reference receiver carries bound', family+'fn read<T:api::Child>(item:&T)->i32{item.value()}fn main(){let c=Cell(20);println!("{}",read(&c));}', '20\n'],
  ['supertrait annotation carries bound', family+'fn read<T:api::Child>(item:T)->i32{let value:T=item;value.value()}fn main(){println!("{}",read(Cell(21)));}', '21\n'],
  ['supertrait import alias is canonical', 'mod api{pub trait A{}pub trait B:A{}}use api::B as Bound;struct C;impl api::A for C{}impl Bound for C{}fn require<T:Bound>(_:T){}fn main(){require(C);}', ''],
  ['supertrait required parent provided by blanket impl', 'trait A{}trait B:A{}impl<T>A for T{}struct C;impl B for C{}fn main(){}', ''],
  ['supertrait duplicate parent and diamond deduplicate', 'trait A{}trait B:A+A{}trait C:A{}trait D:B+C{}struct X;impl A for X{}impl B for X{}impl C for X{}impl D for X{}fn main(){}', ''],
];
export const supertraitCompileFailCases = [
  ['supertrait missing required implementation', 'trait A{}trait B:A{}struct C;impl B for C{}fn main(){}','E0277'],
  ['supertrait unused generic impl must prove parent', 'trait A{}trait B:A{}struct C<T>(T);impl<T:A>A for C<T>{}impl<T>B for C<T>{}fn main(){}','E0277'],
  ['supertrait missing builtin bound', 'trait A:Copy{}struct C(String);impl A for C{}fn main(){}','E0277'],
  ['supertrait self cycle', 'trait A:A{}fn main(){}','E0391'],
  ['supertrait indirect cycle', 'trait A:B{}trait B:C{}trait C:A{}fn main(){}','E0391'],
  ['supertrait where clause cycle', 'trait A where Self:B{}trait B:A{}fn main(){}','E0391'],
  ['supertrait cycle exists without implementations', 'trait A:B{}trait B:A{}fn main(){}','E0391'],
  ['supertrait unknown bound', 'trait A:Missing{}fn main(){}','E0405'],
  ['supertrait generic arguments on non-generic parent', 'trait A{}trait B:A<i32>{}fn main(){}','E0107'],
  ['supertrait private parent cannot be named externally', 'mod a{trait A{}}trait B:a::A{}fn main(){}','E0603'],
  ['supertrait inherited method does not belong to child impl', 'trait A{fn a(&self);}trait B:A{}struct C;impl A for C{fn a(&self){}}impl B for C{fn a(&self){}}fn main(){}','E0407'],
  ['supertrait import alone cannot expose parent methods', family+'use api::Child;fn main(){println!("{}",Cell(0).value());}','E0599'],
  ['supertrait privileges cannot leak to same concrete type', family+'fn read<T:api::Child>(item:T)->i32{item.value()+Cell(0).value()}fn main(){println!("{}",read(Cell(1)));}','E0599'],
  ['supertrait obligations cannot leak to unrelated parameters', family+'fn read<T:api::Child,U>(item:T,other:U)->i32{item.value()+other.value()}fn main(){println!("{}",read(Cell(1),Cell(1)));}','E0599'],
  ['supertrait ambiguous inherited names', 'mod a{pub trait A{fn value(&self)->i32;}}mod b{pub trait B{fn value(&self)->i32;}}trait C:a::A+b::B{}struct X;impl a::A for X{fn value(&self)->i32{1}}impl b::B for X{fn value(&self)->i32{2}}impl C for X{}fn read<T:C>(x:T)->i32{x.value()}fn main(){println!("{}",read(X));}','E0034'],
  ['supertrait wrong user Sized is not builtin', 'trait Sized{}trait A:Sized{fn same(self)->Self{self}}fn main(){}','E0277'],
];

supertraitCases.push(
  ['supertrait closure capture retains lexical bound', family+'fn read<T:api::Child>(item:T)->i32{let f=||item.value();f()}fn main(){println!("{}",read(Cell(22)));}', '22\n'],
  ['supertrait mutable-reference capture preserves origin', family+'fn read<T:api::Child>(item:T)->i32{let f=move ||item.value();f()}fn main(){println!("{}",read(Cell(23)));}', '23\n'],
  ['supertrait default generic factory stays distinct from impl parameter', 'mod a{pub trait A{fn make()->Self;}pub trait B:A{}}impl a::A for i32{fn make()->Self{24}}impl a::B for i32{}trait Factory{fn call<T:a::B>(&self)->T{T::make()}}struct C<T>(T);impl<T>Factory for C<T>{}fn main(){println!("{}",C(true).call::<i32>());}', '24\n']
);
supertraitCompileFailCases.push(
  ['supertrait closure cannot expose bound to concrete receiver', family+'fn read<T:api::Child>(item:T)->i32{let f=||item.value()+Cell(0).value();f()}fn main(){println!("{}",read(Cell(1)));}', 'E0599'],
  ['supertrait borrow capture cannot expose bound to other generic', family+'fn read<T:api::Child,U>(item:T,other:U)->i32{let f=||item.value()+other.value();f()}fn main(){println!("{}",read(Cell(1),Cell(2)));}', 'E0599']
);
