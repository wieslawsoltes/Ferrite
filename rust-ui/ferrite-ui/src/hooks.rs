use std::{any::Any, cell::{Cell,RefCell}, rc::Rc};
use crate::abi;
thread_local! { static CURRENT: RefCell<Option<Rc<Frame>>> = const { RefCell::new(None) }; }
pub(crate) struct Frame {
    pub slots: RefCell<Vec<(&'static str,Rc<dyn Any>)>>, pub cursor: Cell<usize>,
    pub rendered: Cell<bool>, pub alive: Rc<Cell<bool>>, pub pending: RefCell<Vec<Box<dyn FnOnce()>>>,
}
impl Frame { pub fn new()->Self {Self {slots:RefCell::new(vec![]),cursor:Cell::new(0),rendered:Cell::new(false),alive:Rc::new(Cell::new(true)),pending:RefCell::new(vec![])}} }
impl Drop for Frame {fn drop(&mut self){self.alive.set(false);}}
struct Guard(Option<Rc<Frame>>);
impl Drop for Guard {fn drop(&mut self){CURRENT.with(|c|*c.borrow_mut()=self.0.take());}}
pub(crate) fn within<T>(frame:Rc<Frame>,render:impl FnOnce()->T)->T {
    frame.cursor.set(0); frame.pending.borrow_mut().clear();
    let _guard=Guard(CURRENT.with(|c|c.replace(Some(frame.clone()))));
    let result=render();
    assert_eq!(frame.cursor.get(),frame.slots.borrow().len(),"Fewer native UI hooks rendered");
    frame.rendered.set(true); result
}
fn hook<T:Any>(kind:&'static str,initialize:impl FnOnce(Rc<Cell<bool>>)->T)->Rc<T> {
    let frame=CURRENT.with(|c|c.borrow().clone()).expect("Native UI hook outside component render");
    let i=frame.cursor.get(); assert!(i<1000,"Native UI hook budget exceeded"); frame.cursor.set(i+1);
    if let Some((old,value))=frame.slots.borrow().get(i) {
        assert_eq!(*old,kind,"Native UI hook order changed");
        return value.clone().downcast().unwrap_or_else(|_|panic!("Native UI hook type changed"));
    }
    assert!(!frame.rendered.get(),"More native UI hooks rendered");
    let value=Rc::new(initialize(frame.alive.clone())); frame.slots.borrow_mut().push((kind,value.clone())); value
}
struct StateCell<T>{value:RefCell<T>,alive:Rc<Cell<bool>>}
pub struct Signal<T>(Rc<StateCell<T>>);
impl<T> Clone for Signal<T>{fn clone(&self)->Self{Self(self.0.clone())}}
impl<T:Clone> Signal<T>{
    pub fn get(&self)->T{self.0.value.borrow().clone()}
    pub fn set(&self,value:T){
        assert!(CURRENT.with(|c|c.borrow().is_none()),"State mutation during native render");
        if self.0.alive.get(){*self.0.value.borrow_mut()=value;abi::invalidate();}
    }
    pub fn update(&self,update:impl FnOnce(T)->T){let next=update(self.get());self.set(next);}
}
pub fn state<T:Clone+'static>(initial:T)->Signal<T>{state_with(||initial)}
pub fn state_with<T:Clone+'static>(initial:impl FnOnce()->T)->Signal<T>{Signal(hook("state",|alive|StateCell{value:RefCell::new(initial()),alive}))}
pub fn use_state<T:Clone+'static>(initial:T)->Signal<T>{state(initial)}
pub fn read<T:Clone>(state:Signal<T>)->T{state.get()}
pub fn write<T:Clone>(state:Signal<T>,value:T){state.set(value)}
pub fn modify<T:Clone>(state:Signal<T>,update:impl FnOnce(T)->T){state.update(update)}
pub fn get(state:Signal<i64>)->i64{state.get()}
pub fn set(state:Signal<i64>,value:i64){state.set(value)}
pub fn update(state:Signal<i64>,f:impl FnOnce(i64)->i64){state.update(f)}
pub fn use_string(initial:&str)->Signal<String>{state(initial.to_owned())}
pub fn get_string(state:Signal<String>)->String{state.get()}
pub fn set_string(state:Signal<String>,value:String){state.set(value)}
pub fn use_bool(initial:bool)->Signal<bool>{state(initial)}
pub fn get_bool(state:Signal<bool>)->bool{state.get()}
pub fn set_bool(state:Signal<bool>,value:bool){state.set(value)}
pub fn memo_with<T:Clone+'static,D:PartialEq+'static>(factory:impl FnOnce()->T,dependencies:D)->T {
    let cell=hook("memo",|_|RefCell::new(None::<(D,T)>));
    let change=cell.borrow().as_ref().is_none_or(|(d,_)|d!=&dependencies);
    if change {let value=factory(); *cell.borrow_mut()=Some((dependencies,value));}
    let value=cell.borrow().as_ref().unwrap().1.clone(); value
}
pub fn memo_value<T:Clone+'static>(factory:impl FnOnce()->T,dependencies:&str)->T{memo_with(factory,dependencies.to_owned())}
pub fn memo(factory:impl FnOnce()->i64,dependencies:&str)->i64{memo_value(factory,dependencies)}
struct Effect<D>{deps:Option<D>,cleanup:Option<Box<dyn FnOnce()>>}
impl<D> Drop for Effect<D>{fn drop(&mut self){if let Some(cleanup)=self.cleanup.take(){cleanup();}}}
pub fn effect_with<D:PartialEq+'static>(setup:impl FnOnce()+'static,cleanup:impl FnOnce()+'static,dependencies:D){
    let cell=hook("effect",|_|RefCell::new(Effect::<D>{deps:None,cleanup:None}));
    if cell.borrow().deps.as_ref()!=Some(&dependencies){
        CURRENT.with(|c|c.borrow().as_ref().unwrap().pending.borrow_mut().push(Box::new(move ||{
            let previous=cell.borrow_mut().cleanup.take();if let Some(f)=previous{f();}
            setup(); let mut value=cell.borrow_mut();value.deps=Some(dependencies);value.cleanup=Some(Box::new(cleanup));
        })));
    }
}
pub fn effect(setup:impl FnOnce()+'static,cleanup:impl FnOnce()+'static,dependencies:&str){effect_with(setup,cleanup,dependencies.to_owned())}
#[derive(Clone,Copy,Debug)] pub struct Ref{pub(crate) id:u32}
thread_local!{static NEXT_REF:Cell<u32>=const{Cell::new(1)};}
pub fn use_ref()->Ref{*hook("ref",|_|Ref{id:NEXT_REF.with(|n|{let v=n.get();n.set(v.checked_add(1).expect("Ref ID exhaustion"));v})})}
