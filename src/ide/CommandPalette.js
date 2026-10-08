export class CommandPalette {
  constructor(host,getCommands) {this.host=host;this.getCommands=getCommands;this.opened=false;this.renderShell();}
  renderShell(){
    const overlay=document.createElement("div");overlay.className="command-overlay hidden";
    const panel=document.createElement("div");panel.className="command-panel";
    const input=document.createElement("input");input.placeholder="Search Everywhere — files, commands, compiler stages";input.setAttribute("aria-label","Search commands");
    const results=document.createElement("div");results.className="command-results";
    input.oninput=()=>this.renderResults(input.value);
    input.onkeydown=e=>{if(e.key==="Escape")this.close();if(e.key==="Enter"){results.querySelector("button")?.click();e.preventDefault();}};
    overlay.onclick=e=>{if(e.target===overlay)this.close();};panel.append(input,results);overlay.append(panel);this.host.append(overlay);
    this.overlay=overlay;this.input=input;this.results=results;
  }
  renderResults(query=""){
    this.results.replaceChildren();let items=this.getCommands();
    const normalized=query.trim().toLowerCase();
    if(normalized)items=items.filter(x=>x.label.toLowerCase().includes(normalized));
    for(const item of items.slice(0,30)){
      const button=document.createElement("button");button.className="command-result";button.textContent=item.label;
      button.onclick=()=>{this.close();item.execute();};this.results.append(button);
    }
  }
  open(){this.opened=true;this.overlay.classList.remove("hidden");this.input.value="";this.renderResults();this.input.focus();}
  close(){this.opened=false;this.overlay.classList.add("hidden");}
}
