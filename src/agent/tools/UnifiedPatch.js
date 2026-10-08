import {AgentError} from '../core/AgentError.js';

/** Strict, context-checked unified patches. No fuzzy application, shell invocation or offset guessing. */
export class UnifiedPatch {
  static apply(original, patch) {
    if (typeof patch !== 'string' || patch.length > 4 * 1024 * 1024) throw Error('Patch exceeds 4 MiB');
    const lines = patch.split('\n'); if (lines.at(-1) === '') lines.pop();
    let index = 0; while (index < lines.length && !lines[index].startsWith('@@ ')) index++;
    if (!index && !lines[0]?.startsWith('@@ ') || index === lines.length) throw Error('Unified patch contains no hunks');
    const source = original === null ? [] : original.match(/[^\n]*\n|[^\n]+$/g) ?? [], output = []; let cursor = 0, hunks = 0;
    while (index < lines.length) {
      const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(lines[index++]);
      if (!header) throw new AgentError('PATCH_FORMAT', 'Expected a unified hunk header');
      const oldStart = +header[1], oldCount = header[2] === undefined ? 1 : +header[2], newStart = +header[3], newCount = header[4] === undefined ? 1 : +header[4];
      const start = oldCount === 0 ? oldStart : oldStart - 1;
      if (start < cursor || start > source.length) throw new AgentError('PATCH_RANGE', 'Overlapping or out-of-range patch hunk');
      output.push(...source.slice(cursor, start)); cursor = start;
      if ((newCount === 0 ? newStart : newStart - 1) !== output.length) throw new AgentError('PATCH_RANGE', 'New-file hunk location does not match preceding hunks');
      let removed = 0, added = 0;
      while (index < lines.length && !lines[index].startsWith('@@ ')) {
        const line = lines[index++], prefix = line[0];
        if (![' ', '+', '-'].includes(prefix)) throw new AgentError('PATCH_FORMAT', 'Unexpected unified patch line');
        let content = line.slice(1) + '\n';
        if (lines[index] === '\\ No newline at end of file') { content = content.slice(0, -1); index++; }
        if (prefix !== '+') { if (source[cursor] !== content) throw new AgentError('PATCH_CONTEXT', `Patch context does not match original line ${cursor + 1}`); cursor++; removed++; }
        if (prefix !== '-') { output.push(content); added++; }
      }
      if (removed !== oldCount || added !== newCount) throw new AgentError('PATCH_COUNT', 'Hunk line counts do not match its header');
      hunks++;
    }
    output.push(...source.slice(cursor)); return {text: output.join(''), hunks};
  }
}
