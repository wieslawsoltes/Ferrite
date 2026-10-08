/** Converts shared IDE build options to literal Cargo argv; never invokes a shell. */
export class CargoOptions {
  static buildCommands = new Set(['inspect', 'check', 'build', 'run', 'test', 'clippy', 'bench', 'rustc', 'rustdoc', 'doc']);
  static featureCommands = new Set([...this.buildCommands, 'metadata', 'tree']);

  static arguments(command, options = {}) {
    const args = [], workspace = options.workspace && !['run','inspect','rustc','rustdoc'].includes(command), allTargets = options.allTargets && !['run','inspect','rustc','rustdoc'].includes(command);
    if (workspace && this.buildCommands.has(command) && command !== 'run') args.push('--workspace');
    if (allTargets && this.buildCommands.has(command) && command !== 'run' && command !== 'inspect') args.push('--all-targets');
    if (!workspace && options.package && (this.buildCommands.has(command) || command === 'tree' || command === 'fmt'))
      args.push('--package', options.package);
    if (options.target && !workspace && !allTargets && this.buildCommands.has(command)) {
      if (options.targetKind === 'lib') args.push('--lib');
      else {
        const kind = options.targetKind ?? 'bin';
        if (!['bin','example','test','bench'].includes(kind)) throw Error('Unsupported Cargo target kind');
        args.push('--' + kind, options.target);
      }
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
    if (options.targetTriple && this.buildCommands.has(command)) {
      if (!/^[a-zA-Z0-9_.-]+$/.test(options.targetTriple)) throw Error('Invalid target triple');
      args.push('--target', options.targetTriple);
    }
    if (options.keepGoing && ['build','check','test','clippy'].includes(command)) args.push('--keep-going');
    if (options.timings && ['build','check','run','test','clippy','bench','doc','rustc'].includes(command)) args.push('--timings');
    if (options.profile && this.buildCommands.has(command)) {
      if (!/^[a-zA-Z0-9_-]+$/.test(options.profile)) throw Error('Invalid Cargo profile');
      args.push('--profile', options.profile);
    }
    if (!options.profile && options.release && this.buildCommands.has(command)) args.push('--release');
    if (['run','test','bench'].includes(command) && options.programArgs?.length) {
      if (!Array.isArray(options.programArgs) || options.programArgs.some(v => typeof v !== 'string' || v.includes('\0'))) throw Error('Expected a string array of program arguments');
      args.push('--', ...options.programArgs);
    }
    return args;
  }
}
