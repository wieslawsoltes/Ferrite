export class SymbolTableView {
  constructor(root,onSelect){this.root=root;this.onSelect=onSelect;}
  render(symbols){
    this.root.replaceChildren();
    const table=document.createElement("table");table.className="symbol-table";
    const head=document.createElement("tr");for(const n of ["Name","Kind","Line"]){const cell=document.createElement("th");cell.textContent=n;head.append(cell);}table.append(head);
    for(const symbol of symbols){
      const row=document.createElement("tr");
      for(const n of [symbol.name,symbol.kind,symbol.line]){const cell=document.createElement("td");cell.textContent=String(n);row.append(cell);}
      row.title="Jump to "+symbol.name;row.onclick=()=>this.onSelect(symbol.loc||{line:symbol.line,column:1});table.append(row);
    }
    this.root.append(table);
  }
}
