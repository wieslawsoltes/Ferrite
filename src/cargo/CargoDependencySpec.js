/** Structured dependency edits delegated to installed cargo add/remove, not ad-hoc TOML rewriting. */
export class CargoDependencySpec {
  static arguments(input, remove = false) {
    const name = input?.name;
    if (typeof name !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_-]{0,127}$/.test(name)) throw Error('Invalid crate name');
    const args = [];
    if (input.package) { this.text(input.package); args.push('--package', input.package); }
    if (input.kind === 'dev') args.push('--dev'); else if (input.kind === 'build') args.push('--build');
    else if (input.kind && input.kind !== 'normal') throw Error('Invalid dependency kind');
    if (remove) return [...args, name];
    if (input.source === 'path') { this.text(input.path); args.push('--path', input.path); }
    else if (input.source === 'git') {
      const url = new URL(input.git);
      if (!['https:', 'ssh:'].includes(url.protocol) || url.password || url.search || url.hash ||
          (url.username && !(url.protocol === 'ssh:' && url.username === 'git'))) throw Error('Use a Git HTTPS/SSH URL without credentials');
      args.push('--git', url.href);
      const revisions = ['rev', 'tag', 'branch'].filter(key => input[key]);
      if (revisions.length > 1) throw Error('Choose one of revision, tag, or branch');
      for (const key of revisions) { this.text(input[key]); args.push('--' + key, input[key]); }
    } else if (!input.source || input.source === 'registry') {
      if (input.registry) { this.text(input.registry); args.push('--registry', input.registry); }
    } else throw Error('Choose registry, Git, or path');
    if (input.rename) { this.text(input.rename); args.push('--rename', input.rename); }
    if (input.defaultFeatures === false) args.push('--no-default-features');
    else if (input.defaultFeatures === true) args.push('--default-features');
    if (input.optional === true) args.push('--optional');
    else if (input.optional === false) args.push('--no-optional');
    if (input.features?.length) {
      if (!Array.isArray(input.features) || input.features.some(value => typeof value !== 'string' || !/^[\w+./-]+$/.test(value))) throw Error('Invalid crate features');
      args.push('--features', [...new Set(input.features)].join(','));
    }
    if (input.version) this.text(input.version);
    args.push(name + (input.version ? '@' + input.version : ''));
    return args;
  }
  static text(value) { if (typeof value !== 'string' || !value || value.length > 2048 || /[\0\r\n]/.test(value) || value.startsWith('-')) throw Error('Invalid dependency argument'); }
}
