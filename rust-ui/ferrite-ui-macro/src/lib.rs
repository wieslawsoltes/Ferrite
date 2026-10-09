//! Bounded native `view!` frontend. Embedded Rust TokenStreams are passed to rustc.
extern crate proc_macro;
use proc_macro::{Delimiter, TokenStream, TokenTree};

#[proc_macro]
pub fn view(input: TokenStream) -> TokenStream {
    let mut parser = Parser { tokens: input.into_iter().collect(), index: 0, nodes: 0 };
    let result = parser.node(0).and_then(|node| {
        if parser.index != parser.tokens.len() { Err("Unexpected tokens after view root".into()) } else { Ok(node) }
    });
    match result.and_then(|text| text.parse().map_err(|_| "Invalid generated view syntax".to_string())) {
        Ok(tokens) => tokens,
        Err(message) => format!("compile_error!({message:?})").parse().unwrap(),
    }
}
struct Parser { tokens: Vec<TokenTree>, index: usize, nodes: usize }
impl Parser {
    fn is(&self, c: char) -> bool { matches!(self.tokens.get(self.index), Some(TokenTree::Punct(p)) if p.as_char()==c) }
    fn take(&mut self, c: char) -> bool { if self.is(c) { self.index += 1; true } else { false } }
    fn expect(&mut self, c: char) -> Result<(),String> { if self.take(c) { Ok(()) } else { Err(format!("Expected '{c}' in view")) } }
    fn name(&mut self) -> Result<String,String> {
        let Some(TokenTree::Ident(first)) = self.tokens.get(self.index) else {return Err("Expected tag or attribute name".into())};
        let mut name=first.to_string(); self.index+=1;
        while self.is(':') || self.is('-') {
            let separator=if self.take('-') {"-"} else {self.index+=1;if self.take(':'){"::"}else{":"}};
            let Some(TokenTree::Ident(part))=self.tokens.get(self.index) else {return Err("Incomplete view name".into())};
            name.push_str(separator);name.push_str(&part.to_string());self.index+=1;
        }
        Ok(name)
    }
    fn expression(&mut self)->Result<String,String> {
        match self.tokens.get(self.index).cloned() {
            Some(TokenTree::Group(g)) if g.delimiter()==Delimiter::Brace => {self.index+=1;Ok(format!("{{ {} }}",g.stream()))},
            Some(TokenTree::Literal(l)) => {self.index+=1;Ok(l.to_string())},
            _=>Err("Attribute values must be literals or braced Rust expressions".into()),
        }
    }
    fn node(&mut self,depth:usize)->Result<String,String> {
        self.nodes+=1;if self.nodes>10000||depth>128{return Err("Native view syntax budget exceeded".into())}
        self.expect('<')?;
        let tag=if self.is('>'){String::new()}else{self.name()?};
        let mut attributes=vec![];
        while !self.is('>')&&!self.is('/') {
            let name=self.name()?;
            if attributes.iter().any(|(n,_)|n==&name){return Err(format!("Duplicate attribute {name}"))}
            let value=if self.take('='){self.expression()?}else{"true".into()};
            attributes.push((name,value));
        }
        let closed=self.take('/');self.expect('>')?;
        let mut children=vec![];
        if !closed {
            loop {
                if self.index>=self.tokens.len(){return Err("Missing closing view tag".into())}
                if self.is('<') {
                    if matches!(self.tokens.get(self.index+1),Some(TokenTree::Punct(p)) if p.as_char()=='/') {
                        self.index+=2;let close=if self.is('>'){String::new()}else{self.name()?};self.expect('>')?;
                        if close!=tag{return Err(format!("Mismatched closing tag {close}; expected {tag}"))}break;
                    }
                    children.push(self.node(depth+1)?);
                } else if matches!(self.tokens.get(self.index),Some(TokenTree::Group(g)) if g.delimiter()==Delimiter::Brace) {
                    children.push(format!("::ferrite_ui::child({})",self.expression()?));
                } else if matches!(self.tokens.get(self.index),Some(TokenTree::Literal(_))) {
                    children.push(format!("::ferrite_ui::child({})",self.expression()?));
                } else {
                    let start=self.index;
                    while self.index<self.tokens.len()&&!self.is('<')&&!matches!(self.tokens.get(self.index),Some(TokenTree::Group(_))|Some(TokenTree::Literal(_))){self.index+=1;}
                    if start==self.index{return Err("Use braces for Rust view expressions".into())}
                    let text=self.tokens[start..self.index].iter().cloned().collect::<TokenStream>().to_string();
                    children.push(format!("::ferrite_ui::text({text:?})"));
                }
            }
        }
        let component=tag.contains("::")||tag.chars().next().is_some_and(char::is_uppercase);
        let mut code=String::from("{ let mut __ferrite_node = ");
        if component {
            if !children.is_empty(){return Err("Pass native component children through its explicit props".into())}
            let props=attributes.iter().find(|(n,_)|n=="props").map(|(_,v)|v.as_str());
            code.push_str(&match props {Some(p)=>format!("{{ let props={p}; ::ferrite_ui::component(move || {tag}(props.clone())) }}"),None=>format!("::ferrite_ui::component({tag})")});
        } else if tag.is_empty() {code.push_str(&format!("::ferrite_ui::fragment(vec![{}])",children.join(",")));}
        else {code.push_str(&format!("::ferrite_ui::element({tag:?},vec![{}])",children.join(",")));}
        code.push(';');
        for (name,value) in attributes {
            if component&&name=="props"{continue;}
            if component&&name!="key"{return Err("Native component tags accept only props and key".into())}
            let call=match name.as_str(){
                "key"=>format!("key(__ferrite_node,{value})"),
                "ref"=>format!("node_ref(__ferrite_node,{value})"),
                "on:click"|"onClick"=>format!("on_click(__ferrite_node,{value})"),
                n if n.starts_with("on_event:")=>format!("on_event(__ferrite_node,{:?},{value})",&n[9..]),
                n if n.starts_with("on:")=>format!("on(__ferrite_node,{:?},{value})",&n[3..]),
                _=>format!("attr(__ferrite_node,{name:?},{value})"),
            };
            code.push_str(&format!(" __ferrite_node=::ferrite_ui::{call};"));
        }
        code.push_str(" __ferrite_node }");Ok(code)
    }
}
