import {CargoDependencyResolver} from './CargoDependencyResolver.js';
import {FeatureResolver} from './FeatureResolver.js';
import {TomlParser} from './TomlParser.js';
import {VirtualFileSystem as V} from '../project/VirtualFileSystem.js';

/** Virtual Cargo metadata and local dependency graph; native Cargo owns registry resolution. */
export class CargoWorkspace {
  constructor(files) {
    this.files = files; this.packages = new Map(); this.errors = []; this.warnings = [];
    this.root = this.manifest('Cargo.toml'); this.workspace = this.root.sections.workspace ?? {};
    const members = this.workspace.members ?? [];
    if (this.root.package.name) this.package('Cargo.toml');
    for (const member of members) {
      if (typeof member !== 'string') { this.errors.push({message: 'Workspace members must be strings'}); continue; }
      const regex = this.glob(member.replace(/\/$/, '') + '/Cargo.toml');
      for (const file of Object.keys(files).filter(f => regex.test(f)).sort()) this.package(file);
    }
    if (!this.packages.size) this.errors.push({message: 'Cargo.toml requires [package].name or local [workspace].members'});
  }
  glob(pattern) { return new RegExp('^' + pattern.split('*').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$'); }
  manifest(path) {
    if (!Object.hasOwn(this.files, path)) { this.errors.push({message: `Missing manifest ${path}`}); return {package: {}, dependencies: {}, sections: {}, spans: {}, errors: []}; }
    const manifest = new TomlParser().parse(this.files[path], {file: path}); this.errors.push(...manifest.errors);
    return manifest;
  }
  package(path) {
    if (this.packages.has(path)) return this.packages.get(path);
    const manifest = path === 'Cargo.toml' ? this.root : this.manifest(path), directory = V.directory(path);
    const info = {...manifest.package};
    for (const [key, value] of Object.entries(info)) if (value?.workspace === true) info[key] = this.workspace?.package?.[key];
    if (!info.name || typeof info.name !== 'string' || !/^[A-Za-z0-9_-]+$/.test(info.name)) this.errors.push({message: `Invalid package name in ${path}`, span: manifest.spans.package});
    const pkg = {id: path, path, directory, name: info.name ?? path, version: info.version ?? '0.0.0', edition: String(info.edition ?? '2015'), manifest, targets: [], dependencies: []};
    this.packages.set(path, pkg);
    const target = (kind, name, relative, extra = {}) => {
      const source = V.path(relative, directory);
      if (!Object.hasOwn(this.files, source)) this.errors.push({message: `Missing ${kind} target ${source}`, span: manifest.spans[kind]});
      if(extra.requiredFeatures!==undefined&&(!Array.isArray(extra.requiredFeatures)||extra.requiredFeatures.some(f=>typeof f!=='string'))){this.errors.push({message:`Invalid required-features for ${name}`});extra.requiredFeatures=[];}
      pkg.targets.push({kind, name, path: source, ...extra});
    };
    const lib = manifest.sections.lib;
    if (lib || Object.hasOwn(this.files, V.path('src/lib.rs', directory))) target('lib', lib?.name ?? pkg.name.replaceAll('-', '_'), lib?.path ?? 'src/lib.rs', {procMacro: lib?.['proc-macro'] === true});
    const bins = manifest.sections.bin ?? [];
    if (!Array.isArray(bins)) this.errors.push({message: 'Use [[bin]], not [bin], for binary targets'});
    else for (const bin of bins) target('bin', bin.name ?? pkg.name, bin.path ?? (bin.name === pkg.name ? 'src/main.rs' : `src/bin/${bin.name}.rs`), {requiredFeatures:bin['required-features']??[]});
    const mainPath = V.path('src/main.rs', directory);
    if (Object.hasOwn(this.files, mainPath) && !pkg.targets.some(t => t.path === mainPath) && info.autobins !== false) target('bin', pkg.name, 'src/main.rs');
    if (info.autobins !== false) for (const file of Object.keys(this.files)) {
      const prefix = V.path('src/bin', directory) + '/';
      if (file.startsWith(prefix) && /^[^/]+\.rs$/.test(file.slice(prefix.length)) && !pkg.targets.some(t => t.path === file)) target('bin', file.slice(prefix.length, -3), file.slice(directory ? directory.length + 1 : 0));
    }
    if (!pkg.targets.length) this.errors.push({message: `Package ${pkg.name} has no src/main.rs, src/lib.rs or explicit target`});
    return pkg;
  }
  features(pkg,requested=[],defaults=true){
    const dependencies=Object.fromEntries(Object.entries(pkg.manifest.dependencies).map(([name,spec])=>[name,typeof spec==='string'?{version:spec}:spec]));
    return new FeatureResolver(pkg.manifest.sections.features??{},dependencies).resolve(requested,{defaults});
  }
  plan(command = 'check', options = {}) {
    const roots = [...this.packages.values()], selected = options.package ? roots.find(p => p.name === options.package || p.path === options.package) : roots[0];
    if (!selected) this.errors.push({message: `Package not found: ${options.package ?? '(none)'}`});
    const chosen = selected?.targets.find(t => options.target ? t.name === options.target || t.path === options.target : t.kind === 'bin') ?? selected?.targets[0];
    if (options.target && chosen?.name !== options.target && chosen?.path !== options.target) this.errors.push({message: `Target not found: ${options.target}`});
    const resolution=selected?new CargoDependencyResolver(this,command,options).resolve(selected):{graph:[],buildOrder:[],features:{},dependencies:[],nativeRequired:[],errors:[]};
    const {graph,buildOrder:order,dependencies:external,nativeRequired}=resolution;
    this.errors.push(...resolution.errors);
    if(chosen?.requiredFeatures?.some(feature=>!resolution.features[selected.id]?.enabled.includes(feature)))
      this.errors.push({message:`Target ${chosen.name} requires features: ${chosen.requiredFeatures.join(', ')}`});
    for (const item of nativeRequired) this.warnings.push(item);
    if (external.length) this.warnings.push(`External Cargo dependencies need the native toolchain: ${[...new Set(external)].join(', ')}`);
    return {command, backend: 'ferrite-js', manifest: selected?.manifest ?? this.root, entry: chosen?.path ?? null,
      files: Object.keys(this.files), selected: selected?.id, target: chosen, packages: [...this.packages.values()].map(p => ({id: p.id, name: p.name, version: p.version, edition: p.edition, directory: p.directory, targets: p.targets})),
      dependencies: [...new Set(external)], graph, buildOrder: order, features: resolution.features,
      nativeRequired, warnings: this.warnings, errors: this.errors};
  }
}
