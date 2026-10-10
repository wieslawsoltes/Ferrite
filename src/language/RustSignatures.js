/** Signature slices from the same tolerant token stream used by the editor. */
export class RustSignatures {
  static read(document) {
    const tokens = document.tokens.filter(t => t.context === 'rust' && !['whitespace','comment'].includes(t.kind)), result = [];
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].value !== 'fn' || tokens[i].raw || !tokens[i + 1]?.identifier) continue;
      const name = tokens[i + 1]; let cursor = i + 2, angle = 0;
      for (; cursor < tokens.length; cursor++) {
        const value = tokens[cursor].value;
        if (value === '<') angle++;
        else if (value === '>') angle = Math.max(0, angle - 1);
        else if (value === '>>') angle = Math.max(0, angle - 2);
        else if (value === '(' && angle === 0) break;
        else if (value === '{' || value === ';') break;
      }
      if (tokens[cursor]?.value !== '(') continue;
      const open = cursor, parameters = []; let start = cursor + 1; const stack = [];
      for (++cursor; cursor < tokens.length; cursor++) {
        const value = tokens[cursor].value;
        if ((value === ',' || value === ')') && !stack.length) {
          if (cursor > start) parameters.push({label: document.text.slice(tokens[start].start, tokens[cursor - 1].end)});
          start = cursor + 1; if (value === ')') break;
        } else if ('([{<'.includes(value) && value.length === 1) stack.push({'(':')','[':']','{':'}','<':'>'}[value]);
        else if (value === stack.at(-1)) stack.pop();
        else if (value === '>>') { if (stack.at(-1) === '>') stack.pop(); if (stack.at(-1) === '>') stack.pop(); }
      }
      if (tokens[cursor]?.value !== ')') continue;
      let end = cursor + 1;
      while (end < tokens.length && !['{',';'].includes(tokens[end].value)) end++;
      if (!tokens[end]) continue;
      result.push({name: name.name, selection: document.span(name), start: tokens[i].start, open: tokens[open].start,
        end: tokens[end].start, label: document.text.slice(tokens[i].start, tokens[end].start).trim(), parameters});
    }
    return result;
  }
  static callAt(document, offset) {
    const tokens = document.tokens.filter(t => t.context === 'rust' && t.start < offset && !['whitespace','comment'].includes(t.kind));
    const stack = []; let generic = 0;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i], value = token.value;
      if (value === '<' && (generic || tokens[i - 1]?.value === '::')) { generic++; continue; }
      if (generic) { if (value === '>') generic--; if (value === '>>') generic = Math.max(0, generic - 2); continue; }
      if (['(','[','{'].includes(value)) { stack.push({value, index: i, commas: 0, closure: false}); continue; }
      const frame = stack.at(-1);
      if ([')',']','}'].includes(value)) { if (frame && {'(':')','[':']','{':'}'}[frame.value] === value) stack.pop(); continue; }
      if (!frame) continue;
      if (value === '|') frame.closure = !frame.closure;
      if (value === ',' && !frame.closure) frame.commas++;
    }
    const frame = [...stack].reverse().find(f => f.value === '('); if (!frame) return null;
    let index = frame.index - 1;
    // A completed turbofish sits between the callee and its argument list.
    if (['>','>>'].includes(tokens[index]?.value)) {
      let depth = tokens[index].value.length;
      for (--index; index >= 0; index--) {
        if (tokens[index].value === '>') depth++;
        else if (tokens[index].value === '>>') depth += 2;
        else if (tokens[index].value === '<' && --depth === 0) { index--; break; }
      }
      if (tokens[index]?.value === '::') index--;
    }
    if (!tokens[index]?.identifier) return null;
    let name = tokens[index].name;
    while (tokens[index - 1]?.value === '::' && tokens[index - 2]?.identifier) { index -= 2; name = tokens[index].name + '::' + name; }
    return {name, activeParameter: frame.commas, start: tokens[index].start};
  }
}
