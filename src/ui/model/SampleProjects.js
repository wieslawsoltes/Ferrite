import {SEVEN_GUIS} from './SevenGuisCatalog.js';
import {SampleCatalog} from './SampleCatalog.js';
import {WorkspaceTree} from './WorkspaceTree.js';
import {VirtualFileSystem as V} from '../../project/VirtualFileSystem.js';
import {UIProject} from '../../ui-framework/UIProject.js';

/** Read-only catalog and atomic, collision-free installation plans. Preview never installs. */
export class SampleProjects {
  static all = Object.freeze([...SEVEN_GUIS, ...SampleCatalog.projects.map((sample, index) => ({
    id:`rust-${index}`, title:sample.name, category:sample.native?'Native Rust':'Rust', kind:'rust',
    description:sample.description ?? (sample.native?'Requires an explicitly connected native Cargo toolchain.':sample.expected?`Expected output: ${sample.expected.trim()}`:'Explore an editable Rust compiler example.'),
    tags:sample.native?['Cargo','native']:['compiler','Rust'], files:sample.files, native:!!sample.native,
    entry:Object.hasOwn(sample.files,'src/main.rs')?'src/main.rs':Object.keys(sample.files).find(file=>file.endsWith('.rs'))
  }))]);
  static find(id) { const sample=this.all.find(item=>item.id===id); if(!sample)throw Error('Unknown sample'); return sample; }
  static search(query='',category='All') {
    const words=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return this.all.filter(item=>(category==='All'||item.category===category)&&words.every(word=>`${item.title} ${item.description} ${item.tags.join(' ')}`.toLocaleLowerCase().includes(word)));
  }
  static plan(sample, files=null, folders=[]) {
    const source=V.validate(sample.files); WorkspaceTree.folders(source);
    if(!Object.hasOwn(source,sample.entry))throw Error('Sample entry is missing');
    if(!files)return {files:{[sample.entry]:source[sample.entry],...source},entry:sample.entry};
    if(sample.kind!=='ui')throw Error('Compiler examples open as separate projects; Cargo targets are not implicitly rewritten');
    let prefix=`samples/7guis/${sample.slug}`,suffix=1;
    const occupied=path=>Object.keys(files).some(file=>WorkspaceTree.contains(path,file))||folders.some(folder=>WorkspaceTree.contains(path,folder));
    while(occupied(prefix)){if(++suffix>1000)throw Error('Too many copies of this sample');prefix=`samples/7guis/${sample.slug}-${suffix}`;}
    const changes=Object.fromEntries(Object.entries(source).map(([path,text])=>[`${prefix}/${path}`,text]));
    const entry=`${prefix}/${sample.entry}`,project=UIProject.load(source,sample.entry);
    const settings={...project.settings,entryFile:entry,stylesheet:`${prefix}/${project.settings.stylesheet}`};
    changes[`${prefix}/${project.manifest}`]=JSON.stringify(UIProject.settings(settings,entry),null,2)+'\n';
    const candidate=V.validate({...files,...changes}); WorkspaceTree.folders(candidate,folders);
    return {files:changes,entry};
  }
  static install(model,store,sample,{add=false,expectedEpoch=model.workspaceEpoch,expectedRevision=model.revision}={}) {
    if(expectedEpoch!==model.workspaceEpoch||expectedRevision!==model.revision)throw Error('Workspace changed while browsing. Close and reopen Samples before installing.');
    const plan=this.plan(sample,add?model.files:null,[...model.folders]);
    // Validate everything and archive before publishing any project replacement.
    if(add)model.applyWorkspaceTransaction(plan.files);
    else { store.archive(); model.replace(plan.files,false); model.name=sample.title; model.emit('replace'); }
    if(sample.kind==='ui')model.setDocumentState(plan.entry,{mode:'design'});
    model.open(plan.entry);return {...plan,saved:model.save()};
  }
}
