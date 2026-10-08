import {Dom} from './Dom.js';

/** Cargo owns manifest editing, registry resolution and lockfile updates. */
export class DependencyView {
  constructor(root, controller, {getPackage, onError, onResult}) {
    this.root = root; this.controller = controller; this.getPackage = getPackage; this.onError = onError; this.onResult = onResult;
    this.form = Dom.element('form', 'dependency-form'); this.form.append(Dom.element('h3', 'section-heading', 'Add or remove a crate'));
    this.name = this.field('Crate name'); this.name.id = 'crate-name';
    this.source = Dom.element('select', 'text-field'); this.source.setAttribute('aria-label', 'Crate source');
    for (const [value, text] of [['registry','Registry (crates.io or configured registry)'],['git','Remote Git'],['path','Local path']]) {
      const option = Dom.element('option', '', text); option.value = value; this.source.append(option);
    }
    this.form.append(this.source); this.location = this.field('Git URL, local dependency path, or registry name');
    this.version = this.field('Version requirement (optional)'); this.features = this.field('Crate features (comma separated)'); this.rev = this.field('Git revision (optional)');
    this.rename=this.field('Rename dependency (optional)');this.optional=this.checkbox('Optional dependency',false);this.defaultFeatures=this.checkbox('Enable default crate features',true);
    this.kind = Dom.element('select', 'text-field'); this.kind.setAttribute('aria-label', 'Dependency section');
    for (const [value, text] of [['normal','dependencies'],['dev','dev-dependencies'],['build','build-dependencies']]) { const o = Dom.element('option', '', text); o.value = value; this.kind.append(o); }
    this.form.append(this.kind);
    this.add = Dom.button('Add crate', null, {icon: 'plus', className: 'primary-button'}); this.add.type = 'submit'; this.add.id = 'crate-add';
    this.remove = Dom.button('Remove crate', () => this.apply(true), {icon: 'trash'}); this.form.append(this.add, this.remove);
    this.form.onsubmit = event => { event.preventDefault(); this.apply(false); };
    this.form.append(Dom.element('p', 'view-note', 'Changes run cargo add/remove in the trusted repository. Use the manifest editor for patch tables, workspace inheritance, target-specific dependencies and other Cargo configuration.'));
    this.root.append(this.form); this.render();
  }
  checkbox(label,checked){const wrapper=Dom.element('label','trust-label'),input=Dom.element('input');input.type='checkbox';input.checked=checked;input.setAttribute('aria-label',label);wrapper.append(input,document.createTextNode(label));this.form.append(wrapper);return input;}
  field(label) { const wrapper = Dom.element('label', 'field-label', label), input = Dom.element('input', 'text-field'); input.setAttribute('aria-label', label); wrapper.append(input); this.form.append(wrapper); return input; }
  render() { this.add.disabled = this.remove.disabled = !this.controller.session || !!this.controller.client.active; }
  async apply(remove) {
    this.add.disabled = this.remove.disabled = true;
    try {
      const spec = {name: this.name.value, package: this.getPackage(), source: this.source.value, kind: this.kind.value,
        rename:this.rename.value,optional:this.optional.checked,defaultFeatures:this.defaultFeatures.checked,features: this.features.value.split(',').map(s => s.trim()).filter(Boolean), version: this.version.value, rev: this.rev.value};
      if (spec.source === 'git') spec.git = this.location.value;
      else if (spec.source === 'path') spec.path = this.location.value;
      else spec.registry = this.location.value;
      const result = await this.controller.dependency(spec, remove); this.onResult(result);
    } catch (error) { this.onError(error); } finally { this.render(); }
  }
}
