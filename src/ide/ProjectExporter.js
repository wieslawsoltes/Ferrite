/** Portable project snapshot suitable for native Cargo import. */
export class ProjectExporter {
  static snapshot(files){return {format:"ferrite-project-v1",createdBy:"Ferrite IDE",files:{...files}};}
  static download(files,filename="ferrite-project.ferrite.json"){
    const contents=JSON.stringify(this.snapshot(files),null,2);
    const blob=new Blob([contents],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    try{const a=document.createElement("a");a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();}
    finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
  }
  static parse(contents){const result=JSON.parse(contents);if(result?.format!=="ferrite-project-v1"||!result.files||typeof result.files!=="object")throw Error("Unsupported Ferrite snapshot");return result.files;}
}
