use std::cell::RefCell;
use crate::{Session,Node,Event};
thread_local! {static APP:RefCell<Option<Session>>=const{RefCell::new(None)};}
#[cfg(target_arch="wasm32")]
#[link(wasm_import_module="ferrite_native_ui_v1")]
extern "C" {
    fn view_emit(pointer:*const u8,length:usize);
    fn view_invalidate();
    fn event_text(field:u32,reference:u32,pointer:*mut u8,capacity:usize)->usize;
    fn event_number(field:u32)->f64;
    fn dom_operation(operation:u32,reference:u32);
}
pub fn start(app:impl Fn()->Node+'static){APP.with(|a|{assert!(a.borrow().is_none(),"Native app already started");*a.borrow_mut()=Some(Session::new(app));});}
pub fn render(){let json=APP.with(|a|a.borrow_mut().as_mut().expect("Start the native app first").render());emit(&json);}
pub fn commit(){APP.with(|a|a.borrow_mut().as_mut().expect("Missing native app").commit());}
pub fn dispatch(id:u32){let callback=APP.with(|a|a.borrow().as_ref().and_then(|s|s.callback(id))).expect("Stale native event callback");callback(Event::current());}
pub fn dispose(){let app=APP.with(|a|a.borrow_mut().take());drop(app);}
pub(crate) fn emit(value:&str){
    #[cfg(target_arch="wasm32")] unsafe{view_emit(value.as_ptr(),value.len());}
    #[cfg(not(target_arch="wasm32"))] {let _=value;}
}
pub(crate) fn invalidate(){
    #[cfg(target_arch="wasm32")] unsafe{view_invalidate();}
}
pub(crate) fn text(field:u32,reference:u32)->String{
    #[cfg(target_arch="wasm32")] {
        // Host writes into an initialized buffer. Recheck the exact reported size;
        // JS validates all memory ranges before accessing the current memory buffer.
        let size=unsafe{event_text(field,reference,std::ptr::null_mut(),0)};
        assert!(size<=1024*1024,"Native event string budget exceeded");
        let mut value=vec![0u8;size];
        let written=unsafe{event_text(field,reference,value.as_mut_ptr(),size)};
        assert_eq!(written,size,"Native event changed while copying");
        String::from_utf8(value).expect("Invalid UTF-8 event data")
    }
    #[cfg(not(target_arch="wasm32"))] {let _=(field,reference);String::new()}
}
pub(crate) fn number(field:u32)->f64{
    #[cfg(target_arch="wasm32")] unsafe{return event_number(field);}
    #[cfg(not(target_arch="wasm32"))] {let _=field;0.}
}
pub(crate) fn dom(operation:u32,reference:u32){
    #[cfg(target_arch="wasm32")] unsafe{dom_operation(operation,reference);}
    #[cfg(not(target_arch="wasm32"))] {let _=(operation,reference);}
}
