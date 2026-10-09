/** Typed compiler declarations for the checked Ferrite UI host ABI, not a Rust stdlib. */
export const UI_ABI_VERSION = 1;
export const UI_INTRINSICS = Object.freeze(['element', 'fragment', 'text', 'value', 'attr', 'key', 'component', 'on_click', 'on', 'use_state', 'get', 'set', 'use_string', 'get_string', 'set_string', 'use_bool', 'get_bool', 'set_bool', 'use_ref', 'node_ref', 'focus', 'ref_value', 'effect', 'memo', 'prevent_default']);
// Trap bodies make an unlinked artifact fail explicitly. The UI linker replaces calls
// only to these compiler-owned declarations; arbitrary user functions are never hosts.
export const UI_DECLARATIONS = `
mod ui {
  #[derive(Clone, Copy)] pub struct Node { pub handle: u32 }
  #[derive(Clone, Copy)] pub struct State { pub handle: u32 }
  #[derive(Clone, Copy)] pub struct Ref { pub handle: u32 }
  pub fn element(tag: &str, children: Vec<Node>) -> Node { panic!("UI ABI must be linked") }
  pub fn fragment(children: Vec<Node>) -> Node { panic!("UI ABI must be linked") }
  pub fn text(value: &str) -> Node { panic!("UI ABI must be linked") }
  pub fn value<T: Display>(value: T) -> Node { panic!("UI ABI must be linked") }
  pub fn attr<T: Display>(node: Node, name: &str, value: T) -> Node { panic!("UI ABI must be linked") }
  pub fn key<T: Display>(node: Node, value: T) -> Node { panic!("UI ABI must be linked") }
  pub fn component<F: Fn() -> Node>(render: F) -> Node { panic!("UI ABI must be linked") }
  pub fn on_click<F: Fn() -> ()>(node: Node, callback: F) -> Node { panic!("UI ABI must be linked") }
  pub fn on<F: Fn(String) -> ()>(node: Node, name: &str, callback: F) -> Node { panic!("UI ABI must be linked") }
  pub fn use_state(initial: i64) -> State { panic!("UI ABI must be linked") }
  pub fn get(state: State) -> i64 { panic!("UI ABI must be linked") }
  pub fn set(state: State, value: i64) { panic!("UI ABI must be linked") }
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
