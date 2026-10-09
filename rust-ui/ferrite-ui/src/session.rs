use std::{collections::{HashMap,HashSet},rc::Rc};
use crate::{Node,Event,node::{Kind,Attribute},hooks::{Frame,within}};

/// One synchronous application. Render prepares; commit releases removed owners,
/// publishes callbacks, then runs effects. User callbacks execute outside any borrow.
pub struct Session {
    app:Rc<dyn Fn()->Node>, frames:HashMap<String,Rc<Frame>>,
    callbacks:HashMap<u32,Rc<dyn Fn(Event)>>, next_callback:u32,
    staged:Option<(HashSet<String>,HashMap<u32,Rc<dyn Fn(Event)>>)>,
}
impl Session {
    pub fn new(app:impl Fn()->Node+'static)->Self {Self{app:Rc::new(app),frames:HashMap::new(),callbacks:HashMap::new(),next_callback:1,staged:None}}
    pub fn render(&mut self)->String {
        assert!(self.staged.is_none(),"Commit native render before rendering again");
        let mut seen=HashSet::new();let mut callbacks=HashMap::new();let mut count=0;
        let root=Node{key:None,kind:Kind::Component{identity:std::any::TypeId::of::<Session>(),render:self.app.clone()}};
        let tree=self.node(root,"root",0,&mut seen,&mut callbacks,&mut count);
        let hooks:usize=self.frames.iter().filter(|(p,_)|seen.contains(*p)).map(|(_,f)|f.slots.borrow().len()).sum();
        let output=format!("{{\"abi\":1,\"tree\":{tree},\"components\":{},\"hooks\":{hooks}}}",seen.len());
        assert!(output.len()<=4*1024*1024,"Native view byte budget exceeded");
        self.staged=Some((seen,callbacks));output
    }
    pub fn commit(&mut self) {
        let (seen,callbacks)=self.staged.take().expect("No prepared native render");
        self.callbacks=callbacks;
        // Remove in sorted order for deterministic effect disposal.
        let mut removed:Vec<_>=self.frames.keys().filter(|p|!seen.contains(*p)).cloned().collect();removed.sort();
        for path in removed {if let Some(frame)=self.frames.remove(&path){frame.alive.set(false);drop(frame);}}
        let mut paths:Vec<_>=seen.into_iter().collect();paths.sort();
        let mut pending=vec![];
        for path in paths{pending.extend(self.frames[&path].pending.borrow_mut().drain(..));}
        for run in pending{run();}
    }
    pub fn callback(&self,id:u32)->Option<Rc<dyn Fn(Event)>>{self.callbacks.get(&id).cloned()}
    pub fn callback_ids(&self)->Vec<u32>{let mut ids:Vec<_>=self.callbacks.keys().copied().collect();ids.sort();ids}
    pub fn counts(&self)->(usize,usize){(self.frames.len(),self.callbacks.len())}
    fn children(&mut self,nodes:Vec<Node>,path:&str,depth:usize,seen:&mut HashSet<String>,callbacks:&mut HashMap<u32,Rc<dyn Fn(Event)>>,count:&mut usize)->String {
        let mut keys=HashSet::new();let mut output=Vec::with_capacity(nodes.len());
        for (index,node) in nodes.into_iter().enumerate(){
            let part=match &node.key{Some(key)=>{assert!(keys.insert(key.clone()),"Duplicate native sibling key");format!("k{}:{key}",key.len())},None=>format!("i{index}")};
            output.push(self.node(node,&format!("{path}/{part}"),depth+1,seen,callbacks,count));
        }
        format!("[{}]",output.join(","))
    }
    fn node(&mut self,node:Node,path:&str,depth:usize,seen:&mut HashSet<String>,callbacks:&mut HashMap<u32,Rc<dyn Fn(Event)>>,count:&mut usize)->String {
        *count+=1;assert!(*count<=10000&&depth<=128,"Native view node/depth budget exceeded");
        let key=node.key.as_ref().map(|s|quote(s)).unwrap_or_else(||"null".into());
        match node.kind{
            Kind::Text(s)=>format!("{{\"text\":{},\"key\":{key}}}",quote(&s)),
            Kind::Fragment(nodes)=>{let children=self.children(nodes,path,depth,seen,callbacks,count);format!("{{\"children\":{children},\"key\":{key}}}")},
            Kind::Component{identity,render}=>{
                let path=format!("{path}/c{identity:?}");seen.insert(path.clone());
                let frame=self.frames.entry(path.clone()).or_insert_with(||Rc::new(Frame::new())).clone();
                let node=within(frame,||render());
                let child=self.node(node,&format!("{path}/render"),depth+1,seen,callbacks,count);
                format!("{{\"children\":[{child}],\"key\":{key}}}")
            },
            Kind::Element{tag,props,children,events,reference}=>{
                let props=props.into_iter().map(|(name,value)|format!("{}:{}",quote(&name),match value{Attribute::Text(s)=>quote(&s),Attribute::Boolean(b)=>b.to_string()})).collect::<Vec<_>>().join(",");
                let mut handlers=vec![];
                for (name,callback) in events{let id=self.next_callback;self.next_callback=id.checked_add(1).expect("Callback ID exhaustion");callbacks.insert(id,callback);handlers.push(format!("[{},{}]",quote(&name),id));}
                let children=self.children(children,&format!("{path}/e{}:{tag}",tag.len()),depth,seen,callbacks,count);
                format!("{{\"tag\":{},\"props\":{{{props}}},\"events\":[{}],\"children\":{children},\"key\":{key},\"ref\":{}}}",quote(&tag),handlers.join(","),reference.unwrap_or(0))
            }
        }
    }
}
impl Drop for Session {fn drop(&mut self){for frame in self.frames.values(){frame.alive.set(false);}self.callbacks.clear();self.staged=None;}}
pub(crate) fn quote(value:&str)->String{
    let mut out=String::from("\"");for c in value.chars(){match c{'"'=>out.push_str("\\\""),'\\'=>out.push_str("\\\\"),'\n'=>out.push_str("\\n"),'\r'=>out.push_str("\\r"),'\t'=>out.push_str("\\t"),c if c<'\u{20}'=>out.push_str(&format!("\\u{:04x}",c as u32)),c=>out.push(c)}}out.push('"');out
}
