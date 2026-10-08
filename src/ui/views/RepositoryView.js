import {Dom} from './Dom.js';
import {DialogService} from './DialogService.js';
import {LocalFolderImporter} from '../services/LocalFolderImporter.js';

/** Repository lifecycle controls. Native filesystem consent is separate from bridge authentication. */
export class RepositoryView {
  constructor(root, controller, {onError, onBrowserFolder}) {
    this.root = root; this.controller = controller; this.onError = onError; this.onBrowserFolder = onBrowserFolder;
    this.form = Dom.element('form', 'repository-form');
    this.form.append(Dom.element('h3', 'section-heading', 'Open a Cargo repository'));
    this.kind = this.select('Repository source', [['remote', 'Clone remote Git repository'], ['local', 'Open authorized local directory']]);
    this.path = this.input('Git URL or absolute local path', 'https://github.com/owner/project.git'); this.path.id = 'repository-path';
    this.ref = this.input('Git branch, tag or commit (optional)', 'Default branch');
    this.manifest = this.input('Cargo manifest', 'Cargo.toml'); this.manifest.value = 'Cargo.toml';
    const consent = Dom.element('label', 'trust-label'); this.trust = Dom.element('input'); this.trust.type = 'checkbox'; this.trust.id = 'repository-trust';
    consent.append(this.trust, document.createTextNode('I trust this repository. Replace the browser workspace; synchronize IDE edits to this checkout. Native builds, build scripts, dependencies and programs run with my local permissions.'));
    this.submodules=Dom.element('input');this.submodules.type='checkbox';this.submodules.setAttribute('aria-label','Initialize remote Git submodules');const sub=Dom.element('label','trust-label');sub.append(this.submodules,document.createTextNode('Initialize remote Git submodules (HTTPS/SSH only)'));this.form.append(sub,consent);
    this.openButton = Dom.button('Open repository', null, {icon: 'folder', className: 'primary-button'}); this.openButton.type = 'submit'; this.openButton.id = 'repository-open';
    this.form.append(this.openButton); this.form.onsubmit = event => { event.preventDefault(); this.action(async () => {
      if (!this.trust.checked) throw Error('Confirm repository trust first');
      await this.controller.open({kind: this.kind.value, path: this.path.value, url: this.path.value,
        ref: this.ref.value, manifest: this.manifest.value, submodules:this.submodules.checked, trust: true});
    }); };
    this.trust.onchange = () => this.render();
    this.info = Dom.element('div', 'repository-info'); this.root.append(this.form, this.info);
    this.folder = Dom.element('input'); this.folder.type = 'file'; this.folder.multiple = true; this.folder.setAttribute('webkitdirectory', ''); this.folder.hidden = true;
    this.folder.onchange = () => this.action(async () => { const result = await LocalFolderImporter.read(this.folder.files); this.folder.value = ''; this.onBrowserFolder(result); });
    this.root.append(Dom.button('Import local folder into browser compiler', () => this.folder.click(), {icon: 'folder', className: 'wide-button'}), this.folder,
      Dom.element('p', 'view-note', 'Native sessions keep assets and Cargo caches on disk. Browser folder import copies text only and uses the Rust subset. Local roots require --allow-root PATH on the bridge.'));
    this.sessionList=Dom.element('div','repository-session-list');this.root.append(Dom.button('List bridge sessions',()=>this.action(()=>this.list()),{className:'wide-button'}),this.sessionList);
    this.render();
  }
  async list(){
    const sessions=await this.controller.list();this.sessionList.replaceChildren();
    for(const session of sessions){
      const row=Dom.element('div','repository-session');row.append(Dom.element('code','repository-location',session.root));
      const resume=Dom.button('Resume checkout',()=>this.action(async()=>{if(await DialogService.ask({title:'Resume repository?',message:'Replace the browser workspace with this checkout. Export current browser edits first.',input:false,confirm:'Resume'}))await this.controller.resume(session.id);}));
      const close=Dom.button('Close checkout',()=>this.action(async()=>{if(await DialogService.ask({title:'Close repository?',message:session.owned?'Delete this temporary clone and its edits/build cache. Export changes first.':'Detach without deleting this local directory.',input:false,confirm:'Close'})){await this.controller.closeDetached(session.id);await this.list();}}));
      resume.disabled=close.disabled=session.busy;row.append(resume,close);this.sessionList.append(row);
    }
    if(!sessions.length)this.sessionList.append(Dom.element('p','view-note','No open native sessions.'));
  }
  input(label, placeholder = '') { const wrapper = Dom.element('label', 'field-label', label), field = Dom.element('input', 'text-field'); field.placeholder = placeholder; field.setAttribute('aria-label', label); wrapper.append(field); this.form.append(wrapper); return field; }
  select(label, choices) { const wrapper = Dom.element('label', 'field-label', label), field = Dom.element('select', 'text-field'); field.setAttribute('aria-label', label); for (const [value, text] of choices) { const option = Dom.element('option', '', text); option.value = value; field.append(option); } wrapper.append(field); this.form.append(wrapper); return field; }
  async action(action) { this.openButton.disabled = true; try { await action(); } catch (error) { this.onError(error); } finally { this.render(); } }
  render() {
    this.openButton.disabled = !this.trust.checked || !this.controller.client.capabilities?.repositories || !!this.controller.client.active;
    this.info.replaceChildren(); const session = this.controller.session;
    if (!session) { this.info.append(Dom.element('p', 'view-note', 'No native repository attached. Connect Native Cargo before opening a repository.')); return; }
    this.info.append(Dom.element('h3', 'section-heading', 'Native checkout'), Dom.element('p', 'repository-location', session.source),
      Dom.element('code', 'repository-location', session.root), Dom.element('p', 'view-note', `${session.head?.slice(0, 12) ?? 'Local directory'} · revision ${session.version} · ${Object.keys(session.files).length} editable files · ${session.omittedCount} omitted from editor (retained on disk)`));
    const manifests = Dom.element('select', 'text-field'); manifests.setAttribute('aria-label', 'Native Cargo manifest');
    for (const path of session.manifests) { const option = Dom.element('option', '', path); option.value = path; manifests.append(option); } manifests.value = session.manifest;
    this.info.append(manifests, Dom.button('Reload checkout / selected manifest', () => this.action(async () => {
      if (await DialogService.ask({title: 'Reload repository?', message: 'Replace the browser text with files from disk. Export unsynchronized browser edits first.', input: false, confirm: 'Reload'})) await this.controller.reload(manifests.value);
    }), {icon: 'reset', className: 'wide-button'}), Dom.button('Close repository session', () => this.action(async () => {
      if (await DialogService.ask({title: 'Close native repository?', message: session.owned ? 'The temporary clone, its edits and build cache will be removed. Export your source changes first.' : 'Detach the local directory without deleting it.', input: false, confirm: 'Close'})) await this.controller.close();
    }), {icon: 'close', className: 'wide-button'}));
    if (this.controller.needsReload) this.info.append(Dom.element('p', 'warning-note', 'Reload required: a previous operation conflicted or lost its response. Export your current edits first.'));
    if (session.metadataError) this.info.append(Dom.element('p', 'warning-note', session.metadataError));
  }
}
