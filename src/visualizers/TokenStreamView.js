/** Source-linked token visualization with lexical classification. */
export class TokenStreamView {
  constructor(root,onSelect){this.root=root;this.onSelect=onSelect;}
  render(tokens){
    this.root.replaceChildren();
    const panel=document.createElement("div");panel.className="token-stream";
    const keywords=new Set(["fn","let","mut","if","else","while","loop","for","in","return","break","continue","struct","pub","true","false"]);
    for(const token of tokens){
      const button=document.createElement("button");button.className="token-chip";
      const value=token.value;
      let kind=keywords.has(value)?"keyword":/^\d/.test(value)?"number":value.startsWith('"')?"string":/^[A-Za-z_]/.test(value)?"identifier":"punctuation";
      if(value==="EOF")kind="eof";
      button.dataset.kind=kind;button.textContent=value;
      button.title=kind+" · "+token.line+":"+token.column;
      button.onclick=()=>this.onSelect({offset:token.offset,line:token.line,column:token.column});
      panel.append(button);
    }
    this.root.append(panel);
  }
}
