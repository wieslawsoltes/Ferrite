use ferrite_ui::{self as ui,view};
use std::{cell::{Cell,RefCell},rc::Rc};

#[test]
fn state_events_and_stale_callbacks() {
    let mut session=ui::Session::new(||{
        let n=ui::state(0i64);let click=n.clone();
        view!{<button on:click={move ||click.update(|v|v+1)}>{n.get()}</button>}
    });
    assert!(session.render().contains("\"text\":\"0\""));session.commit();
    let id=session.callback_ids()[0];session.callback(id).unwrap()(ui::Event::default());
    assert!(session.render().contains("\"text\":\"1\""));session.commit();assert!(session.callback(id).is_none());
}
#[test]
fn native_generics_refs_macros_and_components_compile() {
    #[derive(Clone)]struct Props{label:String}
    #[allow(non_snake_case)]fn Card(p:Props)->ui::Node{view!{<div>{p.label}</div>}}
    let mut s=ui::Session::new(||{
        let v=ui::state(vec![(1u128,"hello".to_owned())]);let r=ui::use_ref();
        let memo=ui::memo_with(||v.get(),7u32);
        view!{<><Card props={Props{label:memo[0].1.clone()}} key="a"/><input ref={r} disabled={false} /></>}
    });
    let json=s.render();assert!(json.contains("hello"));assert!(json.contains("\"disabled\":false"));s.commit();
}
#[test]
fn effects_run_at_commit_and_drop_once() {
    let log=Rc::new(RefCell::new(vec![]));let a=log.clone();let b=log.clone();
    let mut s=ui::Session::new(move ||{let a=a.clone();let b=b.clone();ui::effect_with(move ||a.borrow_mut().push("setup"),move ||b.borrow_mut().push("cleanup"),0);ui::text("ok")});
    s.render();assert!(log.borrow().is_empty());s.commit();assert_eq!(&*log.borrow(),&["setup"]);
    s.render();s.commit();assert_eq!(log.borrow().len(),1);drop(s);assert_eq!(&*log.borrow(),&["setup","cleanup"]);
}
#[test]
fn keyed_components_preserve_state_when_reordered() {
    let reverse=Rc::new(Cell::new(false));let r=reverse.clone();
    let mut s=ui::Session::new(move ||{
        let mut keys=vec!["a","b"];if r.get(){keys.reverse();}
        ui::fragment(keys.into_iter().map(|key|ui::key(ui::component(move ||{
            let count=ui::state(0);let click=count.clone();
            ui::on_click(ui::element("button",vec![ui::text(&format!("{key}:{}",count.get()))]),move ||click.update(|v|v+1))
        }),key)).collect())
    });
    s.render();s.commit();s.callback(s.callback_ids()[0]).unwrap()(ui::Event::default());reverse.set(true);
    let json=s.render();assert!(json.contains("a:1"));assert!(json.find("b:0").unwrap()<json.find("a:1").unwrap());s.commit();
}
#[test]
fn hook_order_is_checked_and_render_guard_unwinds() {
    let flag=Rc::new(Cell::new(true));let f=flag.clone();
    let mut s=ui::Session::new(move ||{if f.get(){ui::state(1);}ui::text("ok")});s.render();s.commit();flag.set(false);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(||s.render())).is_err());
    let mut fresh=ui::Session::new(||{let a=ui::state(2);ui::value(a.get())});assert!(fresh.render().contains("2"));
}
#[test]
fn mutation_during_render_is_rejected() {
    let mut s=ui::Session::new(||{let a=ui::state(1);a.set(2);ui::text("no")});
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(||s.render())).is_err());
}
#[test]
fn removed_signals_are_detached_and_effects_are_cleaned() {
    let visible=Rc::new(Cell::new(true));let v=visible.clone();
    let holder=Rc::new(RefCell::new(None::<ui::Signal<i64>>));let h=holder.clone();
    let cleaned=Rc::new(Cell::new(0));let c=cleaned.clone();
    let mut s=ui::Session::new(move ||{
        if !v.get(){return ui::text("gone");}
        let h=h.clone();let c=c.clone();
        ui::component(move ||{let n=ui::state(3);*h.borrow_mut()=Some(n.clone());
            let c=c.clone();ui::effect_with(||{},move ||c.set(c.get()+1),());ui::value(n.get())})
    });
    s.render();s.commit();visible.set(false);s.render();s.commit();
    assert_eq!(cleaned.get(),1);let saved=holder.borrow().as_ref().unwrap().clone();saved.set(5);assert_eq!(saved.get(),3);
}
#[test]
fn sibling_key_collisions_are_rejected() {
    let mut s=ui::Session::new(||ui::fragment(vec![ui::key(ui::text("a"),1),ui::key(ui::text("b"),1)]));
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(||s.render())).is_err());
}
#[test]
fn escaping_preserves_control_characters_unicode_and_markup_as_data() {
    let mut s=ui::Session::new(||ui::text("\"\\\n\0🦀</script>"));
    let json=s.render();assert!(json.contains("\\\"\\\\\\n\\u0000🦀</script>"));s.commit();
}
