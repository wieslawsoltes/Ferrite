use std::{fmt::Display, rc::Rc};
use crate::abi;

/// An owned event snapshot, safe to retain after the DOM dispatch finishes.
#[derive(Clone, Debug, Default)]
pub struct Event {
    pub event_type: String, pub value: String, pub key: String, pub code: String,
    pub input_type: String, pub data: String,
    pub checked: bool, pub repeat: bool, pub alt_key: bool, pub ctrl_key: bool,
    pub meta_key: bool, pub shift_key: bool,
    pub button: i32, pub buttons: u32, pub pointer_id: i32,
    pub client_x: f64, pub client_y: f64, pub pressure: f64,
    pub delta_x: f64, pub delta_y: f64, pub delta_z: f64, pub time_stamp: f64,
}
impl Event {
    pub(crate) fn current() -> Self {
        Self { event_type: abi::text(0,0), value: abi::text(1,0), key: abi::text(2,0),
            code: abi::text(3,0), input_type: abi::text(4,0), data: abi::text(5,0),
            checked: abi::number(0)!=0., repeat: abi::number(1)!=0., alt_key: abi::number(2)!=0.,
            ctrl_key: abi::number(3)!=0., meta_key: abi::number(4)!=0., shift_key: abi::number(5)!=0.,
            button: abi::number(6) as i32, buttons: abi::number(7) as u32, pointer_id: abi::number(8) as i32,
            client_x: abi::number(9), client_y: abi::number(10), pressure: abi::number(11),
            delta_x: abi::number(12), delta_y: abi::number(13), delta_z: abi::number(14), time_stamp: abi::number(15) }
    }
}
#[derive(Clone)]
pub struct Node { pub(crate) key: Option<String>, pub(crate) kind: Kind }
#[derive(Clone)]
pub(crate) enum Kind {
    Text(String), Fragment(Vec<Node>),
    Element { tag: String, props: Vec<(String, Attribute)>, children: Vec<Node>, events: Vec<(String, Rc<dyn Fn(Event)>)>, reference: Option<u32> },
    Component { identity: std::any::TypeId, render: Rc<dyn Fn() -> Node> },
}
#[derive(Clone, Debug)]
pub enum Attribute { Text(String), Boolean(bool) }
pub trait IntoAttribute { fn into_attribute(self) -> Attribute; }
impl IntoAttribute for bool { fn into_attribute(self)->Attribute { Attribute::Boolean(self) } }
impl IntoAttribute for String { fn into_attribute(self)->Attribute { Attribute::Text(self) } }
impl IntoAttribute for &str { fn into_attribute(self)->Attribute { Attribute::Text(self.to_owned()) } }
impl IntoAttribute for &String { fn into_attribute(self)->Attribute { Attribute::Text(self.clone()) } }
pub trait IntoNode { fn into_node(self) -> Node; }
impl IntoNode for Node { fn into_node(self)->Node { self } }
impl<T: IntoNode> IntoNode for Vec<T> { fn into_node(self)->Node { fragment(self.into_iter().map(IntoNode::into_node).collect()) } }
impl<T: IntoNode> IntoNode for Option<T> { fn into_node(self)->Node { self.map(IntoNode::into_node).unwrap_or_else(||fragment(vec![])) } }
impl IntoNode for String { fn into_node(self)->Node { text(&self) } }
impl IntoNode for &str { fn into_node(self)->Node { text(self) } }
impl IntoNode for bool { fn into_node(self)->Node { fragment(vec![]) } }
macro_rules! scalars { ($($t:ty),*) => {$ (
    impl IntoAttribute for $t { fn into_attribute(self)->Attribute { Attribute::Text(self.to_string()) } }
    impl IntoNode for $t { fn into_node(self)->Node { value(self) } }
)*}; }
scalars!(i8,i16,i32,i64,i128,isize,u8,u16,u32,u64,u128,usize,f32,f64,char);
pub fn element(tag: &str, children: Vec<Node>) -> Node { Node {key:None,kind:Kind::Element {tag:tag.into(),props:vec![],children,events:vec![],reference:None}} }
pub fn fragment(children: Vec<Node>) -> Node { Node {key:None,kind:Kind::Fragment(children)} }
pub fn text(text: &str) -> Node { Node {key:None,kind:Kind::Text(text.into())} }
pub fn value(value: impl Display) -> Node { text(&value.to_string()) }
pub fn child(value: impl IntoNode) -> Node { value.into_node() }
pub fn key(mut node: Node, value: impl Display) -> Node { node.key=Some(value.to_string()); node }
pub fn attr(mut node: Node, name:&str, value:impl IntoAttribute)->Node {
    let Kind::Element {props,..}=&mut node.kind else { panic!("Attributes require an element") };
    props.retain(|(n,_)| n!=name); props.push((name.into(),value.into_attribute())); node
}
pub fn source(node:Node,id:&str)->Node { attr(node,"data-ferrite-source",id) }
pub fn component<F: Fn()->Node+'static>(render:F)->Node { Node {key:None,kind:Kind::Component {identity:std::any::TypeId::of::<F>(),render:Rc::new(render)}} }
pub fn on_event(mut node:Node,name:&str,callback:impl Fn(Event)+'static)->Node {
    let Kind::Element {events,..}=&mut node.kind else { panic!("Events require an element") };
    events.retain(|(n,_)| n!=name); events.push((name.into(),Rc::new(callback))); node
}
pub fn on_click(node:Node,callback:impl Fn()+'static)->Node { on_event(node,"click",move |_|callback()) }
pub fn on(node:Node,name:&str,callback:impl Fn(String)+'static)->Node { on_event(node,name,move |e|callback(e.value)) }
pub fn node_ref(mut node:Node,reference:crate::Ref)->Node {
    let Kind::Element {reference:r,..}=&mut node.kind else {panic!("DOM refs require an element")}; *r=Some(reference.id); node
}
pub fn prevent_default() { abi::dom(0,0); }
pub fn stop_propagation() { abi::dom(1,0); }
pub fn focus(reference:crate::Ref) { abi::dom(2,reference.id); }
pub fn ref_value(reference:crate::Ref)->String { abi::text(100,reference.id) }
