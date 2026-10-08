import {ModuleAssembler} from "../cargo/ModuleAssembler.js";
/** Maps generated crate offsets to source files and editor selections. */
export class SourceNavigator {
  constructor(getCompilation,getFiles,openFile,getEditor){
    this.getCompilation=getCompilation;this.getFiles=getFiles;this.openFile=openFile;this.getEditor=getEditor;
  }
  mergedPosition(loc){
    const unit=this.getCompilation()?.unit;if(!loc||!unit)return null;
    if(Number.isInteger(loc.offset))return loc.offset;
    const lines=unit.source.split("\n");let offset=0;
    for(let i=0;i<loc.line-1;i++)offset+=(lines[i]?.length??0)+1;
    return offset+(loc.column??1)-1;
  }
  originalPosition(loc){
    const unit=this.getCompilation()?.unit;if(!unit)return null;
    const offset=this.mergedPosition(loc);
    if(offset===null)return null;
    const original=ModuleAssembler.originalForOffset(unit,offset);if(!original)return null;
    const source=this.getFiles()[original.path];if(typeof source!=="string")return null;
    const before=source.slice(0,original.offset).split("\n");
    return {...original,line:before.length,column:before.at(-1).length+1};
  }
  sourceToMerged(path,offset){
    const unit=this.getCompilation()?.unit;
    if(!unit)return null;
    for(const segment of unit.sourceMap){
      if(segment.path===path&&offset>=segment.originalOffset&&offset<segment.originalOffset+segment.length){
        const mergedOffset=segment.start+offset-segment.originalOffset;
        const before=unit.source.slice(0,mergedOffset).split("\n");
        return {offset:mergedOffset,line:before.length,column:before.at(-1).length+1};
      }
    }
    return null;
  }
  jump(loc){
    const original=this.originalPosition(loc);if(!original)return false;
    this.openFile(original.path);
    const editor=this.getEditor();
    editor.focus();editor.setSelectionRange(original.offset,original.offset+1);
    const lineHeight=21;editor.scrollTop=Math.max(0,(original.line-7)*lineHeight);
    return true;
  }
}
