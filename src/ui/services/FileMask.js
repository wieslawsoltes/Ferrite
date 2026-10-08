/** Wildcard NFA with directory wildcards. Each character visits at most the number of mask states. */
export class FileMask {
  constructor(pattern) {
    this.tokens = []; const characters = Array.from(pattern);
    for (let i = 0; i < characters.length; i++) {
      if (characters[i] === '*') {
        if (characters[i + 1] === '*') {
          while (characters[i + 1] === '*') i++;
          if (characters[i + 1] === '/') { i++; this.tokens.push({kind: 'directories'}); }
          else this.tokens.push({kind: 'all'});
        } else this.tokens.push({kind: 'star'});
      } else this.tokens.push({kind: characters[i] === '?' ? 'one' : 'literal', value: characters[i]});
    }
  }
  expand(states) {
    for (let i = 0; i < this.tokens.length; i++) if (states.has(i) && ['star', 'all', 'directories'].includes(this.tokens[i].kind)) states.add(i + 1);
    return states;
  }
  test(path) {
    let states = this.expand(new Set([0]));
    for (const character of path) {
      const next = new Set();
      for (const state of states) {
        const i = state < 0 ? ~state : state, token = this.tokens[i]; if (!token) continue;
        if (token.kind === 'literal' && token.value === character || token.kind === 'one' && character !== '/') next.add(i + 1);
        else if (token.kind === 'star' && character !== '/' || token.kind === 'all') next.add(i);
        else if (token.kind === 'directories') { next.add(~i); if (character === '/') next.add(i + 1); }
      }
      // Negative states are already traversing a directory; they exit only at an actual slash.
      states = this.expand(next); if (!states.size) return false;
    }
    return states.has(this.tokens.length);
  }
}
