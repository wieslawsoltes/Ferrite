/** Bounded CSS declaration scanning and source-friendly absolute canvas geometry. */
export class CanvasLayout {
  static geometry(value, {grid = 1, snap = false} = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['x', 'y', 'width', 'height'].includes(k))) throw Error('Invalid canvas rectangle');
    if (!Number.isFinite(grid) || grid < 1 || grid > 256 || typeof snap !== 'boolean') throw Error('Invalid canvas snapping');
    const result = {};
    for (const key of ['x', 'y', 'width', 'height']) {
      let n = value[key];
      if (!Number.isFinite(n) || Math.abs(n) > 1000000 || (key === 'width' || key === 'height') && n < 1) throw Error(`Invalid canvas ${key}`);
      if (snap) n = Math.round(n / grid) * grid;
      result[key] = Math.round((key === 'width' || key === 'height' ? Math.max(1, n) : n) * 1000) / 1000;
    }
    return result;
  }
  static declarations(css) {
    if (typeof css !== 'string' || css.length > 64000) throw Error('Inline CSS exceeds its limit');
    const entries = []; let start = 0, quote = null, comment = false, depth = 0, colon = -1;
    const emit = end => {
      const raw = css.slice(start, end);
      if (raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/;$/, '').trim()) {
        if (colon < start) throw Error('Incomplete inline CSS declaration');
        const name = css.slice(start, colon).replace(/\/\*[\s\S]*?\*\//g, '').trim();
        if (!/^(?:--[\w-]+|[a-zA-Z-]+)$/.test(name)) throw Error('Invalid inline CSS property');
        entries.push({start, end, name: name.startsWith('--') ? name : name.toLowerCase()});
      }
      start = end; colon = -1;
    };
    for (let i = 0; i < css.length; i++) {
      const c = css[i], next = css[i + 1];
      if (comment) { if (c === '*' && next === '/') { comment = false; i++; } continue; }
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
      if (c === '/' && next === '*') { comment = true; i++; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') { if (--depth < 0) throw Error('Unbalanced inline CSS'); }
      else if (c === '{' || c === '}') throw Error('CSS blocks are not inline declarations');
      else if (!depth && c === ':' && colon < start) colon = i;
      else if (!depth && c === ';') emit(i + 1);
    }
    if (quote || comment || depth) throw Error('Unterminated inline CSS token');
    emit(css.length); return entries;
  }
  static style(css, rectangle, options = {}) {
    const rect = this.geometry(rectangle, options), declarations = this.declarations(css);
    const replacements = new Map(Object.entries({position: 'absolute', left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px`, 'box-sizing': 'border-box', right: 'auto', bottom: 'auto', margin: '0'}));
    // Conflicting logical geometry or transforms need an explicit source decision.
    if (declarations.some(d => /^(inset|translate|rotate|scale|transform|writing-mode)/.test(d.name))) throw Error('Remove transforms/logical inset properties before absolute canvas editing');
    let result = '', cursor = 0;
    for (const declaration of declarations) {
      result += css.slice(cursor, declaration.start);
      if (!replacements.has(declaration.name)) result += css.slice(declaration.start, declaration.end);
      cursor = declaration.end;
    }
    result += css.slice(cursor);
    if (result.trim() && !result.trimEnd().endsWith(';')) result += ';';
    return `${result}${result && !/\s$/.test(result) ? ' ' : ''}${[...replacements].map(([name, value]) => `${name}: ${value};`).join(' ')}`;
  }
}
