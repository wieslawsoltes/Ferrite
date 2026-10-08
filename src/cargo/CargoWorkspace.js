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
      pkg.targets.push({kind, name, path: source, ...extra});
    };
    const lib = manifest.sections.lib;
    if (lib || Object.hasOwn(this.files, V.path('src/lib.rs', directory))) target('lib', lib?.name ?? pkg.name.replaceAll('-', '_'), lib?.path ?? 'src/lib.rs', {procMacro: lib?.['proc-macro'] === true});
    const bins = manifest.sections.bin ?? [];
    if (!Array.isArray(bins)) this.errors.push({message: 'Use [[bin]], not [bin], for binary targets'});
    else for (const bin of bins) target('bin', bin.name ?? pkg.name, bin.path ?? (bin.name === pkg.name ? 'src/main.rs' : `src/bin/${bin.name}.rs`));
    const mainPath = V.path('src/main.rs', directory);
    if (Object.hasOwn(this.files, mainPath) && !pkg.targets.some(t => t.path === mainPath) && info.autobins !== false) target('bin', pkg.name, 'src/main.rs');
    if (info.autobins !== false) for (const file of Object.keys(this.files)) {
      const prefix = V.path('src/bin', directory) + '/';
      if (file.startsWith(prefix) && /^[^/]+\.rs$/.test(file.slice(prefix.length)) && !pkg.targets.some(t => t.path === file)) target('bin', file.slice(prefix.length, -3), file.slice(directory ? directory.length + 1 : 0));
    }
    if (!pkg.targets.length) this.errors.push({message: `Package ${pkg.name} has no src/main.rs, src/lib.rs or explicit target`});
    return pkg;
  }
  features(pkg, requested = [], defaults = true) {
    const declarations = pkg.manifest.sections.features ?? {}, enabled = new Set(), dependencies = new Set(), stack = defaults ? ['default', ...requested] : [...requested];
    while (stack.length) {
      const feature = stack.pop(); if (enabled.has(feature)) continue; enabled.add(feature);
      if (feature.startsWith('dep:')) { dependencies.add(feature.slice(4)); continue; }
      if (feature.includes('/')) { dependencies.add(feature.split('/')[0].replace('?', '')); continue; }
      const list = declarations[feature];
      if (list != null && !Array.isArray(list)) this.errors.push({message: `Feature ${feature} must be an array`});
      if (Array.isArray(list)) stack.push(...list.filter(x => typeof x === 'string'));
    }
    return {enabled: [...enabled], dependencies: [...dependencies]};
  }
  plan(command = 'check', options = {}) {
    const roots = [...this.packages.values()], selected = options.package ? roots.find(p => p.name === options.package || p.path === options.package) : roots[0];
    if (!selected) this.errors.push({message: `Package not found: ${options.package ?? '(none)'}`});
    const chosen = selected?.targets.find(t => options.target ? t.name === options.target || t.path === options.target : t.kind === 'bin') ?? selected?.targets[0];
    if (options.target && chosen?.name !== options.target && chosen?.path !== options.target) this.errors.push({message: `Target not found: ${options.target}`});
    const graph = [], order = [], active = new Set(), visited = new Set(), external = [], nativeRequired = [], featureInfo = new Map();
    const visit = (pkg, features = options.features ?? [], defaults = options.defaultFeatures !== false) => {
      if (active.has(pkg.id)) { this.errors.push({message: `Cyclic local dependency involving ${pkg.name}`}); return; }
      if (visited.has(pkg.id)) return;
      visited.add(pkg.id); active.add(pkg.id);
      const state = this.features(pkg, features, defaults); featureInfo.set(pkg.id, state);
      if (pkg.targets.some(t => t.procMacro)) nativeRequired.push(`${pkg.name}: procedural macros require native Cargo`);
      const buildScript = pkg.manifest.package.build;
      if (typeof buildScript === 'string' || (buildScript !== false && Object.hasOwn(this.files, V.path('build.rs', pkg.directory)))) nativeRequired.push(`${pkg.name}: build script requires native Cargo`);
      const sections = [['dependencies', pkg.manifest.dependencies]];
      if (command === 'test') sections.push(['dev-dependencies', pkg.manifest.sections['dev-dependencies'] ?? {}]);
      if (Object.keys(pkg.manifest.sections['build-dependencies'] ?? {}).length) nativeRequired.push(`${pkg.name}: build dependencies require native Cargo`);
      for (const [kind, entries] of sections) for (const [alias, raw] of Object.entries(entries)) {
        let spec = typeof raw === 'string' ? {version: raw} : raw;
        if (!spec || typeof spec !== 'object' || Array.isArray(spec)) { this.errors.push({message: `Invalid dependency ${alias}`}); continue; }
        let base = pkg.directory;
        if (spec.workspace) { spec = {...(this.workspace.dependencies?.[alias] ?? {}), ...spec}; base = ''; }
        if (spec.optional && !state.dependencies.includes(alias) && !state.enabled.includes(alias)) continue;
        const edge = {from: pkg.id, alias: alias.replaceAll('-', '_'), kind, spec, span: pkg.manifest.spans[`${kind}.${alias}`]};
        if (typeof spec.path === 'string') {
          const manifestPath = V.path(spec.path + '/Cargo.toml', base);
          if (!Object.hasOwn(this.files, manifestPath)) { this.errors.push({message: `Local dependency ${alias} requires ${manifestPath}`, span: edge.span}); continue; }
          const target = this.package(manifestPath); edge.to = target.id;
          if (!target.targets.some(t => t.kind === 'lib')) this.errors.push({message: `Dependency ${alias} has no library target`});
          graph.push(edge); visit(target, spec.features ?? [], spec['default-features'] !== false);
        } else { external.push(alias); edge.to = spec.git ?? `registry:${alias}@${spec.version ?? '*'}`; graph.push(edge); }
      }
      active.delete(pkg.id); order.push(pkg.id);
    };
    if (selected) visit(selected);
    for (const item of nativeRequired) this.warnings.push(item);
    if (external.length) this.warnings.push(`External Cargo dependencies need the native toolchain: ${[...new Set(external)].join(', ')}`);
    return {command, backend: 'ferrite-js', manifest: selected?.manifest ?? this.root, entry: chosen?.path ?? null,
      files: Object.keys(this.files), selected: selected?.id, target: chosen, packages: [...this.packages.values()].map(p => ({id: p.id, name: p.name, version: p.version, edition: p.edition, directory: p.directory, targets: p.targets})),
      dependencies: [...new Set(external)], graph, buildOrder: order, features: Object.fromEntries(featureInfo),
      nativeRequired, warnings: this.warnings, errors: this.errors};
  }
}
