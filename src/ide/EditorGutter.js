export class EditorGutter {
  constructor(gutter,editor,onRun){this.gutter=gutter;this.editor=editor;this.onRun=onRun;this.update=()=>this.render();editor.addEventListener("input",this.update);editor.addEventListener("scroll",()=>{gutter.scrollTop=editor.scrollTop;});}
  render(){
    const source=this.editor.value,lines=source.split("\n");const previous=this.gutter.scrollTop;
    const fragment=document.createDocumentFragment();
    lines.forEach((line,index)=>{const element=document.createElement("div");element.className="gutter-line";
      const main=/^\s*fn\s+main\s*\(/.test(line);element.textContent=main?"▶":" "+(index+1);
      if(main){element.classList.add("gutter-run");element.title="Run main()";element.onclick=()=>this.onRun();}
      else{element.onclick=()=>{const offset=lines.slice(0,index).reduce((n,l)=>n+l.length+1,0);this.editor.focus();this.editor.setSelectionRange(offset,offset);};}
      fragment.append(element);});
    this.gutter.replaceChildren(fragment);this.gutter.scrollTop=previous;
  }
}
