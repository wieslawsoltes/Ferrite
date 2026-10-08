/** Small strict CLI parser shared by the bridge, MCP transport and coding harness. */
export class Arguments {
  constructor(argv, {values = [], flags = []} = {}) {
    this.options = new Map(); this.positionals = [];
    for (let index = 0; index < argv.length; index++) {
      const item = argv[index]; if (!item.startsWith('--')) { this.positionals.push(item); continue; }
      const equals = item.indexOf('='), name = item.slice(2, equals < 0 ? undefined : equals), inline = equals < 0 ? undefined : item.slice(equals + 1);
      if (flags.includes(name)) { if (inline !== undefined) throw Error(`--${name} does not accept a value`); this.options.set(name, true); }
      else if (values.includes(name)) { const value = inline ?? argv[++index]; if (!value || value.startsWith('--')) throw Error(`--${name} requires a value`); const current = this.options.get(name); this.options.set(name, current === undefined ? value : [...(Array.isArray(current) ? current : [current]), value]); }
      else throw Error(`Unknown option --${name}`);
    }
  }
  get(name, fallback) { const value = this.options.get(name); if (Array.isArray(value)) throw Error(`--${name} may only be supplied once`); return value ?? fallback; }
  all(name) { const value = this.options.get(name); return value === undefined ? [] : Array.isArray(value) ? value : [value]; }
}
