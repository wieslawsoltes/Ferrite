/** Converts shared IDE build options to literal Cargo argv; never invokes a shell. */
export class CargoOptions {
  static buildCommands = new Set(['inspect', 'check', 'build', 'run', 'test', 'clippy', 'bench', 'rustc', 'rustdoc', 'doc']);
  static featureCommands = new Set([...this.buildCommands, 'metadata', 'tree']);

  static arguments(command, options = {}) {
    const args = [];
    if (options.package && (this.buildCommands.has(command) || command === 'tree' || command === 'fmt'))
      args.push('--package', options.package);
    if (options.target && this.buildCommands.has(command)) {
      if (options.targetKind === 'lib') args.push('--lib');
      else args.push('--bin', options.target);
    }
    if (this.featureCommands.has(command)) {
      if (options.allFeatures) args.push('--all-features');
      if (options.defaultFeatures === false) args.push('--no-default-features');
      if (options.features?.length) {
        if (!Array.isArray(options.features) || options.features.some(name => typeof name !== 'string' || !/^[\w+:?./-]+$/.test(name)))
          throw Error('Invalid Cargo feature names');
        args.push('--features', [...new Set(options.features)].join(','));
      }
    }
    if (options.release && this.buildCommands.has(command)) args.push('--release');
    return args;
  }
}
