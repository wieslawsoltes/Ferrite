// Predicates, rather than decimal formatting, test exact floating-point behavior.
export const floatCases = [
  ['folded NaN remains unordered', 'fn main(){let n=0.0f64/0.0;println!("{} {}",n==n,n!=n);}', 'false true\n'],
  ['both infinity signs survive literals and folding', 'fn main(){let p=1.0f64/0.0;let n=-1.0f64/0.0;println!("{} {} {}",p>0.0,n<0.0,p==n);}', 'true true false\n'],
  ['negative zero survives optimized emission', 'fn main(){let n=-0.0f64;let p=0.0f64;println!("{} {} {}",1.0/n<0.0,1.0/p>0.0,n==p);}', 'true true true\n'],
  ['constant array keeps each zero sign', 'const V:[f64;2]=[0.0,-0.0];fn main(){println!("{} {}",1.0/V[0]>0.0,1.0/V[1]<0.0);}', 'true true\n'],
  ['constant NaN and infinities roundtrip', 'const N:f64=0.0/0.0;const P:f64=1.0/0.0;const M:f64=-1.0/0.0;fn main(){println!("{} {} {}",N!=N,P>0.0,M<0.0);}', 'true true true\n'],
  ['unsuffixed floats use f32 annotation and return context', 'fn f()->f32{16777217.0}fn main(){let a:f32=16777217.0;println!("{} {}",a==16777216.0f32,f()==16777216.0f32);}', 'true true\n'],
  ['f32 function arguments and repeated arrays', 'fn f(a:f32)->f32{a}const V:[f32;2]=[-0.0;2];fn main(){println!("{} {}",f(16777217.0)==16777216.0f32,1.0f32/V[1]<0.0);}', 'true true\n'],
  ['float to integer casts saturate special values', 'fn main(){let n=0.0f64/0.0;let p=1.0f64/0.0;let m=-1.0f64/0.0;println!("{} {} {}",n as i32,p as u8,m as i8);}', '0 255 -128\n'],
  ['signed zero equality assertions', 'fn main(){assert_eq!(0.0f64,-0.0f64);assert_eq!([0.0f64],[-0.0f64]);println!("ok");}', 'ok\n'],
];
export const floatPanicCases = [
  ['NaN scalar equality assertion fails', 'fn main(){let n=0.0f64/0.0;assert_eq!(n,n);}', 'R_ASSERT'],
  ['NaN aggregate equality assertion fails', 'fn main(){let n=[0.0f64/0.0];assert_eq!(n,n);}', 'R_ASSERT'],
];
export const floatCompileFailCases = [
  ['integer literal cannot become f32 implicitly', 'fn main(){let n:f32=1;}'],
  ['explicit float suffix is not overridden', 'fn main(){let n:f32=1.0f64;}'],
];
