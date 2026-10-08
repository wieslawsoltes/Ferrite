/** TOML 1.0-oriented subset for Cargo manifests.
 * Handles standard tables, dotted tables, strings, integers, booleans, arrays,
 * and inline dependency tables. Unsupported constructs produce diagnostics.
 */
export class TomlParser {
  split(value) {
    const parts=[];let q=null,depth=0,start=0,escaped=false;
    for(let i=0;i<value.length;i++){
      const c=value[i];
      if(q){if(escaped){escaped=false;continue;}if(c==="\\"){escaped=true;continue;}if(c===q)q=null;continue;}
      if(c==='"'||c==="'"){q=c;continue;}
      if(c==="["||c==="{")depth++;
      else if(c==="]"||c==="}")depth--;
      else if(c===","&&depth===0){parts.push(value.slice(start,i).trim());start=i+1;}
    }
    parts.push(value.slice(start).trim());return parts.filter(Boolean);
  }
  parseValue(raw) {
    const text=raw.trim();
    if(text.startsWith('"')&&text.endsWith('"'))return JSON.parse(text);
    if(text.startsWith("'")&&text.endsWith("'"))return text.slice(1,-1);
    if(text==="true"||text==="false")return text==="true";
    if(/^[+-]?\d[\d_]*$/.test(text))return Number(text.replaceAll("_",""));
    if(text.startsWith("[")&&text.endsWith("]"))return this.split(text.slice(1,-1)).map(v=>this.parseValue(v));
    if(text.startsWith("{")&&text.endsWith("}")){
      const object={};
      for(const assignment of this.split(text.slice(1,-1))){
        const i=assignment.indexOf("=");if(i<0)throw Error("Invalid inline table: "+assignment);
        const key=assignment.slice(0,i).trim();
        if(Object.hasOwn(object,key))throw Error("Duplicate inline key "+key);
        object[key]=this.parseValue(assignment.slice(i+1));
      }
      return object;
    }
    throw Error("Unsupported TOML value "+text);
  }
  parse(source) {
    const sections={},errors=[];let path=[];
    const getTable=keys=>{let table=sections;for(const k of keys)table=table[k]??=(Object.create(null));return table;};
    for(const [i,raw] of source.split(/\r?\n/).entries()){
      let line=raw.trim();if(!line||line.startsWith("#"))continue;
      // Remove comments only outside quoted strings.
      let quote=null,escaped=false;
      for(let j=0;j<line.length;j++){const c=line[j];if(quote){if(escaped){escaped=false;continue;}if(c==="\\"){escaped=true;continue;}if(c===quote)quote=null;}else if(c==='"'||c==="'")quote=c;else if(c==="#"){line=line.slice(0,j).trimEnd();break;}}
      if(!line)continue;
      const heading=/^\[([A-Za-z0-9_.-]+)\]$/.exec(line);
      if(heading){path=heading[1].split(".");getTable(path);continue;}
      const assignment=/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line);
      if(!assignment){errors.push({line:i+1,message:"Unsupported TOML syntax"});continue;}
      const keys=assignment[1].split("."),leaf=keys.pop(),table=getTable([...path,...keys]);
      if(Object.hasOwn(table,leaf)){errors.push({line:i+1,message:"Duplicate TOML key "+assignment[1]});continue;}
      try{table[leaf]=this.parseValue(assignment[2]);}catch(error){errors.push({line:i+1,message:error.message});}
    }
    return {package:sections.package??{},dependencies:sections.dependencies??{},sections,errors};
  }
}
