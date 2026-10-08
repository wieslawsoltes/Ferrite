const samples = {
"Generics + formatting": `fn greet<T: Display>(value: T) { println!("Hello, {}!", value); }
fn main() { greet("World"); greet(42u32); }`,
"Arithmetic precedence": `fn main() { let a = 2u32 + 3u32 * 4u32; let b = (2u32 + 3u32) * 4u32; println!("{} and {}", a, b); }`,
"Generic print twice": `fn twice<T: Display>(value: T) { println!("{}", value); println!("{}", value); }
fn main() { twice("Ferrite"); twice(100u32); }`,
"Nested functions": `fn inner<T: Display>(x: T) { println!("inner {}", x); }
fn outer<T: Display>(x: T) { inner(x); }
fn main() { outer(7u32); outer("nested"); }`,
"Type error": `fn f(x: u32) { println!("{}", x); }
fn main() { f("wrong type"); }`,
"Invalid format": `fn main() { println!("{} {}", 42u32); }`
};
const select=document.createElement("select");select.setAttribute("aria-label","Example program");select.style.cssText="margin:8px;padding:9px;background:#1a304a;color:white;border:1px solid #456;border-radius:6px";
for(const k of Object.keys(samples)){const o=document.createElement("option");o.textContent=k;o.value=k;select.append(o);}
select.onchange=()=>{document.getElementById("source").value=samples[select.value];document.getElementById("run").click();};
const run=document.getElementById("run");run.parentNode.insertBefore(select,run);
