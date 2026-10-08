export class ProjectTree {
  constructor(root,onOpen){this.root=root;this.onOpen=onOpen;}
  render(files,active){
    const hierarchy={folders:new Map(),files:[]};
    for(const path of Object.keys(files).sort()){
      let parent=hierarchy;const pieces=path.split("/");
      for(const part of pieces.slice(0,-1)){if(!parent.folders.has(part))parent.folders.set(part,{folders:new Map(),files:[]});parent=parent.folders.get(part);}
      parent.files.push({name:pieces.at(-1),path});
    }
    this.root.replaceChildren();
    const draw=(node,depth)=>{
      for(const [name,subtree] of node.folders){
        const group=document.createElement("div");group.className="project-folder";group.style.paddingLeft=(depth*13+14)+"px";group.textContent="⌄  ◧ "+name;this.root.append(group);draw(subtree,depth+1);
      }
      for(const {name,path} of node.files){
        const button=document.createElement("button");button.className="tree-item"+(active===path?" selected":"");
        button.style.paddingLeft=(depth*13+14)+"px";
        button.textContent=(name.endsWith(".rs")?"🦀 ":name.endsWith(".toml")?"▦ ":"▤ ")+name;
        button.title=path;button.onclick=()=>this.onOpen(path);this.root.append(button);
      }
    };draw(hierarchy,0);
  }
}
