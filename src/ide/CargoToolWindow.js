import {cargoPlan} from "../cargo.js";
export class CargoToolWindow {
  constructor(root,getFiles,onAction){this.root=root;this.getFiles=getFiles;this.onAction=onAction;}
  render(){
    const files=this.getFiles(),plan=cargoPlan(files);
    this.root.replaceChildren();
    const heading=document.createElement("div");heading.className="cargo-title";heading.textContent="Cargo · "+(plan.manifest.package.name||"unconfigured");this.root.append(heading);
    const row=document.createElement("div");row.className="cargo-actions";
    for(const command of ["check","build","run","test"]){const b=document.createElement("button");b.textContent="cargo "+command;b.onclick=()=>this.onAction(command);row.append(b);}
    this.root.append(row);
    for(const [name,values] of [["Targets",[plan.entry]],["Dependencies",plan.dependencies],["Workspace",plan.manifest.sections.workspace?.members||[]]]){
      const section=document.createElement("section");section.className="cargo-section";
      const title=document.createElement("strong");title.textContent=name;section.append(title);
      for(const value of values){const line=document.createElement("div");line.className="cargo-row";line.textContent="◦ "+value;section.append(line);}
      this.root.append(section);
    }
    for(const warning of plan.warnings){const line=document.createElement("div");line.className="cargo-warning";line.textContent=warning;this.root.append(line);}
    return plan;
  }
}
