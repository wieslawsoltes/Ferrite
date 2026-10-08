/** Adapt actual Cargo metadata to the IDE, without using the subset TOML resolver. */
export class NativeCargoMetadata {
  static plan(session, options = {}) {
    const metadata = session.metadata, members = new Set(metadata?.workspace_members ?? []);
    const raw = (metadata?.packages ?? []).filter(pkg => !members.size || members.has(pkg.id));
    const packages = raw.map(pkg => ({id: pkg.id, name: pkg.name, targets: pkg.targets.filter(target => target.kind[0] !== 'custom-build').map(target => ({
      name: target.name, kind: ['bin', 'example', 'test', 'bench'].includes(target.kind[0]) ? target.kind[0] : 'lib', path: target.src_path
    }))}));
    const selected = packages.find(pkg => pkg.name === options.package) ?? packages[0];
    const target = selected?.targets.find(t => t.name === options.target && (!options.targetKind || t.kind === options.targetKind)) ?? selected?.targets.find(t => t.kind === 'bin') ?? selected?.targets[0];
    return {native: true, packages, selected: selected?.id, target,
      features: Object.fromEntries(raw.map(pkg => [pkg.id, {available: Object.keys(pkg.features ?? {}).sort(), enabled: []}])),
      buildOrder: packages.map(p => p.name), graph: raw.flatMap(pkg => (pkg.dependencies??[]).map(dep => ({from: pkg.id, alias: dep.rename ?? dep.name,
        to: dep.path ? `path: ${dep.path}` : dep.source ? `${dep.source} · ${dep.req}` : dep.req}))),
      warnings: session.metadataError ? [session.metadataError] : [], errors: []};
  }
}
