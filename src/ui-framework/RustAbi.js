/** Compiler-owned declarations for the checked Ferrite UI host ABI, not a Rust stdlib. */
export const UI_ABI_VERSION = 1;
export const UI_ABI_FILE = 'ferrite:ui-abi';
export const UI_INTRINSICS = Object.freeze(['element', 'fragment', 'text', 'value', 'child', 'attr', 'key', 'source', 'component', 'on_click', 'on', 'use_state', 'get', 'set', 'update', 'use_string', 'get_string', 'set_string', 'use_bool', 'get_bool', 'set_bool', 'use_ref', 'node_ref', 'focus', 'ref_value', 'effect', 'memo', 'prevent_default', 'stop_propagation', 'state', 'read', 'write', 'modify', 'memo_value', 'memo_with', 'effect_with', 'on_event']);
// Trap bodies make an unlinked artifact fail. Only declarations from UI_ABI_FILE
// may be linked; a similarly-named user function cannot become a host intrinsic.
export const UI_DECLARATIONS = `
mod ui {
  #[derive(Clone, Copy)] pub struct Node { pub handle: u32 }
  #[derive(Clone, Copy)] pub struct State { pub handle: u32 }
  #[derive(Clone, Copy)] pub struct Ref { pub handle: u32 }
  #[derive(Clone, Copy)] pub struct Signal<T> { pub handle: u32, marker: std::marker::PhantomData<T> }
  #[derive(Clone)] pub struct Event {
    pub event_type: String, pub value: String, pub key: String, pub code: String,
    pub checked: bool, pub repeat: bool, pub alt_key: bool, pub ctrl_key: bool,
    pub meta_key: bool, pub shift_key: bool, pub button: i32, pub buttons: u32,
    pub client_x: f64, pub client_y: f64, pub pointer_id: i32, pub pressure: f64,
    pub delta_x: f64, pub delta_y: f64, pub delta_z: f64,
    pub input_type: String, pub data: String, pub time_stamp: f64
  }
  pub fn state<T: Clone>(initial: T) -> Signal<T> { panic!("UI ABI must be linked") }
  pub fn read<T: Clone>(state: Signal<T>) -> T { panic!("UI ABI must be linked") }
  pub fn write<T: Clone>(state: Signal<T>, value: T) { panic!("UI ABI must be linked") }
  pub fn modify<T: Clone, F: Fn(T) -> T>(state: Signal<T>, update: F) { panic!("UI ABI must be linked") }
  pub fn memo_value<T: Clone, F: Fn() -> T>(factory: F, dependencies: &str) -> T { panic!("UI ABI must be linked") }
  pub fn memo_with<T: Clone, D: Clone, F: Fn() -> T>(factory: F, dependencies: D) -> T { panic!("UI ABI must be linked") }
  pub fn effect_with<D: Clone, F: Fn() -> (), C: Fn() -> ()>(setup: F, cleanup: C, dependencies: D) { panic!("UI ABI must be linked") }
  pub fn on_event<F: Fn(Event) -> ()>(node: Node, name: &str, callback: F) -> Node { panic!("UI ABI must be linked") }
  pub fn stop_propagation() { panic!("UI ABI must be linked") }
  pub fn element(tag: &str, children: Vec<Node>) -> Node { panic!("UI ABI must be linked") }
  pub fn fragment(children: Vec<Node>) -> Node { panic!("UI ABI must be linked") }
  pub fn text(value: &str) -> Node { panic!("UI ABI must be linked") }
  pub fn value<T: Display>(value: T) -> Node { panic!("UI ABI must be linked") }
  pub fn child<T>(value: T) -> Node { panic!("UI ABI must be linked") }
  pub fn attr<T: Display>(node: Node, name: &str, value: T) -> Node { panic!("UI ABI must be linked") }
  pub fn key<T: Display>(node: Node, value: T) -> Node { panic!("UI ABI must be linked") }
  pub fn source(node: Node, id: &str) -> Node { panic!("UI ABI must be linked") }
  pub fn component<F: Fn() -> Node>(render: F) -> Node { panic!("UI ABI must be linked") }
  pub fn on_click<F: Fn() -> ()>(node: Node, callback: F) -> Node { panic!("UI ABI must be linked") }
  pub fn on<F: Fn(String) -> ()>(node: Node, name: &str, callback: F) -> Node { panic!("UI ABI must be linked") }
  pub fn use_state(initial: i64) -> State { panic!("UI ABI must be linked") }
  pub fn get(state: State) -> i64 { panic!("UI ABI must be linked") }
  pub fn set(state: State, value: i64) { panic!("UI ABI must be linked") }
  pub fn update<F: Fn(i64) -> i64>(state: State, update: F) { panic!("UI ABI must be linked") }
  pub fn use_string(initial: &str) -> State { panic!("UI ABI must be linked") }
  pub fn get_string(state: State) -> String { panic!("UI ABI must be linked") }
  pub fn set_string(state: State, value: String) { panic!("UI ABI must be linked") }
  pub fn use_bool(initial: bool) -> State { panic!("UI ABI must be linked") }
  pub fn get_bool(state: State) -> bool { panic!("UI ABI must be linked") }
  pub fn set_bool(state: State, value: bool) { panic!("UI ABI must be linked") }
  pub fn use_ref() -> Ref { panic!("UI ABI must be linked") }
  pub fn node_ref(node: Node, reference: Ref) -> Node { panic!("UI ABI must be linked") }
  pub fn focus(reference: Ref) { panic!("UI ABI must be linked") }
  pub fn ref_value(reference: Ref) -> String { panic!("UI ABI must be linked") }
  pub fn effect<F: Fn() -> (), C: Fn() -> ()>(setup: F, cleanup: C, dependencies: &str) { panic!("UI ABI must be linked") }
  pub fn memo<F: Fn() -> i64>(factory: F, dependencies: &str) -> i64 { panic!("UI ABI must be linked") }
  pub fn prevent_default() { panic!("UI ABI must be linked") }
}
`;
