import {Diagnostic} from './Diagnostic.js';
import {Lexer} from './Lexer.js';
import {TokenCursor} from './TokenCursor.js';
import {AttributeParser} from './AttributeParser.js';

const PRECEDENCE = {'||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6,
  '<': 7, '>': 7, '<=': 7, '>=': 7, '+': 8, '-': 8, '*': 9, '/': 9, '%': 9};
const BLOCK_EXPRESSIONS = new Set(['ifExpr', 'ifLet', 'match', 'block', 'loopExpr']);

/** Recursive-descent items/statements and Pratt expressions with complete source spans. */
export class Parser {
  constructor(tokens) { this.c = new TokenCursor(tokens); this.depth = 0; }
  static parse(tokens) { return new Parser(tokens).parse(); }
  parse() {
    const attributes = AttributeParser.read(this.c, {inner:true}), items = [];
    while (!this.c.is('EOF')) items.push(...this.item());
    return {kind: 'crate', items, attributes};
  }
  list(close, parse) {
    const result = [];
    while (!this.c.is(close)) {
      if (this.c.is('EOF')) this.c.eat(close);
      result.push(parse());
      if (!this.c.match(',')) break;
    }
    this.c.eat(close);
    return result;
  }
  attributes() { return AttributeParser.read(this.c); }
  generics() {
    if (!this.c.match('<')) return [];
    return this.list('>', () => {
      const name = this.c.identifier(), bounds = [];
      if (this.c.match(':')) {
        do { bounds.push(this.bound()); } while (this.c.match('+'));
      }
      return {name, bounds};
    });
  }
  bound() {
    const name=this.path();
    if(['Fn','FnMut','FnOnce'].includes(name)&&this.c.match('(')) {
      const params=this.list(')',()=>this.type());
      const result=this.c.match('->')?this.type():'()';return `${name}(${params.join(',')})->${result}`;
    }
    return name;
  }
  path() {
    let path = this.c.identifier();
    while (this.c.is('::') && this.c.peek(1).value !== '<' && this.c.peek(1).value !== '{') {
      this.c.take(); path += '::' + this.c.identifier();
    }
    return path;
  }
  type() {
    if(this.c.match('impl'))return 'impl '+this.bound();
    if (this.c.match('&')) {
      if (this.c.peek().kind === 'lifetime') this.c.take();
      const mutable = !!this.c.match('mut');
      return '&' + (mutable ? 'mut ' : '') + this.type();
    }
    if (this.c.match('(')) return '(' + this.list(')', () => this.type()).join(',') + ')';
    if (this.c.match('[')) {
      const type = this.type();
      this.c.eat(';');
      const length = this.c.take().value;
      if (!/^\d+$/.test(length)) throw new Diagnostic('F0100', 'Array sizes must currently be integer literals', this.c.peek().span);
      this.c.eat(']'); return `[${type};${length}]`;
    }
    let type = this.path();
    if (this.c.match('<')) type += '<' + this.list('>', () => this.type()).join(',') + '>';
    return type;
  }
  item(owner = null, trait = null) {
    const start = this.c.peek(), attributes = this.attributes();
    const visibility = this.c.match('pub') ? 'pub' : 'private';
    if (this.c.match('fn')) return [this.fn(start, {owner, trait, attributes, visibility})];
    if (this.c.match('struct')) {
      const name = this.c.identifier(), generics = this.generics();
      this.c.eat('{');
      const fields = this.list('}', () => {
        const attributes=this.attributes(); this.c.match('pub'); const name = this.c.identifier(); this.c.eat(':'); return {name, type: this.type(), attributes};
      });
      return [this.c.node('struct', start, {name, generics, fields, attributes, visibility})];
    }
    if (this.c.match('enum')) {
      const name = this.c.identifier(), generics = this.generics();
      this.c.eat('{');
      const variants = this.list('}', () => {
        const attributes=this.attributes(), name = this.c.identifier();
        const fields = this.c.match('(') ? this.list(')', () => this.type()) : [];
        return {name, fields, attributes};
      });
      return [this.c.node('enum', start, {name, generics, variants, attributes, visibility})];
    }
    if (this.c.match('impl')) {
      const first = this.type();
      const forTrait = this.c.match('for') ? first : null;
      const target = forTrait ? this.type() : first;
      this.c.eat('{'); const methods = [];
      while (!this.c.is('}')) methods.push(...this.item(target, forTrait));
      this.c.eat('}');
      return [this.c.node('impl', start, {target, trait: forTrait, methods, attributes})];
    }
    if (this.c.match('trait')) {
      const name = this.c.identifier(); this.c.eat('{'); const methods = [];
      while (!this.c.is('}')) methods.push(...this.item('Self', name));
      this.c.eat('}'); return [this.c.node('trait', start, {name, methods, visibility, attributes})];
    }
    if (this.c.match('const')) {
      const name = this.c.identifier(); this.c.eat(':'); const type = this.type(); this.c.eat('=');
      const value = this.expr(); this.c.eat(';');
      return [this.c.node('const', start, {name, type, value, visibility, attributes})];
    }
    if (this.c.match('mod')) {
      const name = this.c.identifier();
      if (this.c.match(';')) return [this.c.node('mod', start, {name, external: true, visibility, attributes})];
      this.c.eat('{'); attributes.push(...AttributeParser.read(this.c,{inner:true})); const items = [];
      while (!this.c.is('}')) items.push(...this.item());
      this.c.eat('}'); return [this.c.node('mod', start, {name, items, external: false, visibility, attributes})];
    }
    if (this.c.match('use')) {
      const path = this.path(), imports = [];
      if (this.c.match('::')) {
        this.c.eat('{');
        imports.push(...this.list('}', () => {
          const name = this.c.identifier();
          return {path: `${path}::${name}`, alias: this.c.match('as') ? this.c.identifier() : name};
        }));
      } else imports.push({path, alias: this.c.match('as') ? this.c.identifier() : path.split('::').at(-1)});
      this.c.eat(';'); return [this.c.node('use', start, {imports, visibility, attributes})];
    }
    throw new Diagnostic('F0101', `Unsupported item '${this.c.peek().value}'`, this.c.peek().span);
  }
  fn(start, details) {
    const localName = this.c.identifier(), generics = this.generics();
    this.c.eat('(');
    const params = this.list(')', () => {
      const start = this.c.peek();
      if (this.c.is('&') && ['self', 'mut'].includes(this.c.peek(1).value)) {
        this.c.take(); const mutable = !!this.c.match('mut'); this.c.eat('self');
        return this.c.node('param', start, {name: 'self', type: '&' + (mutable ? 'mut ' : '') + details.owner, mutable: false});
      }
      const mutable = !!this.c.match('mut'); const name = this.c.identifier();
      const type = name === 'self' && !this.c.is(':') ? details.owner : (this.c.eat(':'), this.type());
      return this.c.node('param', start, {name, type, mutable});
    });
    const returnType = this.c.match('->') ? this.type() : '()';
    const body = this.c.match(';') ? null : this.block();
    return this.c.node('fn', start, {name: details.owner ? `${details.owner}::${localName}` : localName,
      localName, generics, params, returnType, body, ...details});
  }
  block() {
    const start = this.c.eat('{');
    const body = []; let tail = null;
    while (!this.c.is('}')) {
      if (this.c.is('EOF')) this.c.eat('}');
      const start = this.c.peek();
      if (this.c.match(';')) continue;
      if (this.c.match('let')) {
        const mutable = !!this.c.match('mut'), pattern = this.pattern(false);
        const annotation = this.c.match(':') ? this.type() : null;
        this.c.eat('='); const value = this.expr();
        const otherwise = this.c.match('else') ? this.block() : null; this.c.eat(';');
        body.push(this.c.node('let', start, {name: pattern.name, pattern, mutable, annotation, value, otherwise}));
        continue;
      }
      if (this.c.is('return') || this.c.is('break') || this.c.is('continue')) {
        const kind = this.c.take().value;
        const value = this.c.is(';') || this.c.is('}') ? null : this.expr();
        if (kind === 'continue' && value) throw new Diagnostic('E0571', 'continue does not take a value', start.span);
        if (!this.c.is('}')) this.c.eat(';');
        body.push(this.c.node(kind, start, {value})); continue;
      }
      if (this.c.match('while')) {
        if (this.c.match('let')) {
          const pattern = this.pattern(); this.c.eat('=');
          const value = this.expr(0, false), then = this.block();
          body.push(this.c.node('whileLet', start, {pattern, value, then})); continue;
        }
        const condition = this.expr(0, false), then = this.block();
        body.push(this.c.node('while', start, {condition, then})); continue;
      }
      if (this.c.match('for')) {
        const pattern = this.pattern(false); this.c.eat('in');
        const from = this.expr(0, false);
        let to = null, inclusive = false;
        if (this.c.is('..') || this.c.is('..=')) { inclusive = this.c.take().value === '..='; to = this.expr(0, false); }
        const then = this.block();
        body.push(this.c.node('for', start, {name: pattern.name, pattern, from, to, inclusive, then})); continue;
      }
      const value = this.expr();
      if (['=', '+=', '-=', '*=', '/=', '%='].includes(this.c.peek().value)) {
        const op = this.c.take().value, rhs = this.expr(); this.c.eat(';');
        body.push(this.c.node('assign', start, {target: value, op, value: rhs}));
      } else if (this.c.match(';')) body.push(this.c.node('expression', start, {value}));
      else if (this.c.is('}')) { tail = value; break; }
      else if (BLOCK_EXPRESSIONS.has(value.kind)) body.push(this.c.node('expression', start, {value}));
      else this.c.eat(';');
    }
    this.c.eat('}'); return this.c.node('block', start, {body, tail});
  }
  pattern(allowOr = true) {
    const start = this.c.peek();
    let pattern = this.patternAtom();
    if (this.c.is('..') || this.c.is('..=')) {
      const inclusive = this.c.take().value === '..=';
      pattern = this.c.node('rangePattern', start, {from: pattern, to: this.patternAtom(), inclusive});
    }
    if (allowOr && this.c.match('|')) {
      const items = [pattern];
      do { items.push(this.pattern(false)); } while (this.c.match('|'));
      return this.c.node('orPattern', start, {items});
    }
    return pattern;
  }
  patternAtom() {
    const start = this.c.peek();
    if (this.c.match('_')) return this.c.node('wildcard', start);
    if (this.c.match('(')) {
      if (this.c.match(')')) return this.c.node('tuplePattern', start, {items: []});
      const first = this.pattern();
      if (!this.c.match(',')) { this.c.eat(')'); return first; }
      return this.c.node('tuplePattern', start, {items: [first, ...this.list(')', () => this.pattern())]});
    }
    if (this.c.match('mut')) return this.c.node('bindingPattern', start, {name: this.c.identifier(), mutable: true});
    if (['number', 'string', 'char'].includes(start.kind) || ['true', 'false', '-'].includes(start.value)) return this.expr(10);
    const name = this.path();
    if (this.c.match('{')) {
      const fields = []; let rest = false;
      while (!this.c.is('}')) {
        if (this.c.match('..')) { rest = true; this.c.match(','); break; }
        const field = this.c.peek(), mutable = !!this.c.match('mut'), key = this.c.identifier();
        const pattern = this.c.match(':') ? this.pattern() : this.c.node('bindingPattern', field, {name: key, mutable});
        fields.push({name: key, pattern});
        if (!this.c.match(',')) break;
      }
      this.c.eat('}'); return this.c.node('structPattern', start, {name, fields, rest});
    }
    if (this.c.match('(')) return this.c.node('variantPattern', start, {name, items: this.list(')', () => this.pattern())});
    return this.c.node(name.includes('::') || name === 'None' ? 'variantPattern' : 'bindingPattern', start, {name, items: []});
  }
  expr(minimum = 0, allowRecord = true) {
    if (++this.depth > 256) throw new Diagnostic('F0102', 'Expression nesting limit exceeded', this.c.peek().span);
    try {
      let left = this.prefix(allowRecord);
      while (true) {
        const start = left;
        if (allowRecord && this.c.is('{') && left.kind === 'variable' && (this.c.peek(2).value === ':' || this.c.peek(1).value === '}')) {
          this.c.take(); const fields = this.list('}', () => {
            const start = this.c.peek(), name = this.c.identifier();
            const value = this.c.match(':') ? this.expr() : this.c.node('variable', start, {name});
            return {name, value};
          });
          left = this.c.node('structLiteral', start, {name: left.name, fields}); continue;
        }
        if (this.c.match('::')) {
          this.c.eat('<'); const typeArguments = this.list('>', () => this.type());
          left.typeArguments = typeArguments; continue;
        }
        if (this.c.match('!')) {
          if (left.kind !== 'variable') throw new Diagnostic('E0005', 'Expected a macro name', left.span);
          const opening = this.c.take().value, closing = {'(': ')', '[': ']', '{': '}'}[opening];
          if (!closing) throw new Diagnostic('E0005', 'Expected macro delimiter', left.span);
          if(left.name==='cfg'){
            const predicate=AttributeParser.meta(this.c);this.c.match(',');this.c.eat(closing);
            left=this.c.node('cfg',start,{predicate});continue;
          }
          const args = this.list(closing, () => this.expr());
          left = this.c.node('call', start, {callee: left, args, macro: true}); continue;
        }
        if (this.c.match('(')) { left = this.c.node('call', start, {callee: left, args: this.list(')', () => this.expr()), macro: false}); continue; }
        if (this.c.match('[')) { const index = this.expr(); this.c.eat(']'); left = this.c.node('index', start, {object: left, index}); continue; }
        if (this.c.match('.')) {
          const field = this.c.peek().kind === 'number' ? this.c.take().value : this.c.identifier();
          left = this.c.node('field', start, {object: left, field}); continue;
        }
        if (this.c.is('as') && minimum <= 10) { this.c.take(); left = this.c.node('cast', start, {value: left, target: this.type()}); continue; }
        if (this.c.match('?')) { left = this.c.node('try', start, {value: left}); continue; }
        const precedence = PRECEDENCE[this.c.peek().value];
        if (precedence == null || precedence < minimum) break;
        const op = this.c.take().value;
        left = this.c.node('binary', start, {left, op, right: this.expr(precedence + 1, allowRecord)});
      }
      return left;
    } finally { this.depth--; }
  }
  prefix(allowRecord) {
    const start = this.c.peek();
    if (this.c.is('{')) return this.block();
    if (this.c.match('if')) {
      if (this.c.match('let')) {
        const pattern = this.pattern(); this.c.eat('=');
        const value = this.expr(0, false), then = this.block();
        const otherwise = this.c.match('else') ? (this.c.is('if') ? this.expr() : this.block()) : null;
        return this.c.node('ifLet', start, {pattern, value, then, otherwise});
      }
      const condition = this.expr(0, false), then = this.block();
      const otherwise = this.c.match('else') ? (this.c.is('if') ? this.expr() : this.block()) : null;
      return this.c.node('ifExpr', start, {condition, then, otherwise});
    }
    if (this.c.match('loop')) return this.c.node('loopExpr', start, {then: this.block()});
    if (this.c.match('match')) {
      const value = this.expr(0, false); this.c.eat('{'); const arms = [];
      while (!this.c.is('}')) {
        const start = this.c.peek(), pattern = this.pattern();
        const guard = this.c.match('if') ? this.expr(0, false) : null;
        this.c.eat('=>'); const body = this.expr();
        arms.push(this.c.node('arm', start, {pattern, guard, body}));
        if (!this.c.match(',') && !this.c.is('}') && !BLOCK_EXPRESSIONS.has(body.kind)) this.c.eat(',');
      }
      this.c.eat('}'); return this.c.node('match', start, {value, arms});
    }
    if (['-', '!', '&', '*'].includes(start.value)) {
      const op = this.c.take().value, mutable = op === '&' && !!this.c.match('mut');
      return this.c.node('unary', start, {op, mutable, value: this.expr(10, allowRecord)});
    }
    if (this.c.match('(')) {
      if (this.c.match(')')) return this.c.node('literal', start, {value: null, type: '()'});
      const first = this.expr();
      if (!this.c.match(',')) { this.c.eat(')'); return first; }
      const rest = this.list(')', () => this.expr());
      return this.c.node('tuple', start, {items: [first, ...rest]});
    }
    if (this.c.match('[')) {
      if (this.c.match(']')) return this.c.node('array', start, {items: []});
      const first = this.expr();
      if (this.c.match(';')) {
        const count = this.expr(); this.c.eat(']'); return this.c.node('repeatArray', start, {value: first, count});
      }
      const items = [first];
      if (this.c.match(',')) items.push(...this.list(']', () => this.expr())); else this.c.eat(']');
      return this.c.node('array', start, {items});
    }
    if (['true', 'false'].includes(start.value)) { this.c.take(); return this.c.node('literal', start, {value: start.value === 'true', type: 'bool'}); }
    if (start.kind === 'string' || start.kind === 'char') {
      this.c.take(); const value = Lexer.decode(start.value);
      if (start.kind === 'char' && [...value].length !== 1) throw new Diagnostic('E0762', 'A char must contain one Unicode scalar', start.span);
      return this.c.node('literal', start, {value, type: start.kind === 'char' ? 'char' : '&str'});
    }
    if (start.kind === 'number') {
      this.c.take();
      const raw = start.value.replaceAll('_', '');
      const suffix = /([ui](?:8|16|32|64|128|size)|f(?:32|64))$/.exec(raw)?.[1] ?? null;
      const value = suffix ? raw.slice(0, -suffix.length) : raw;
      const floating = !/^0[xbo]/i.test(value) && /[.eE]/.test(value);
      return this.c.node('literal', start, {value, type: suffix ?? (floating ? 'f64' : '{integer}'), suffix});
    }
    if (['move','|','||'].includes(start.value)) {
      const move=!!this.c.match('move'),params=[];
      if(!this.c.match('||')){
        this.c.eat('|');while(!this.c.is('|')){
          const at=this.c.peek(),mutable=!!this.c.match('mut'),name=this.c.identifier();
          params.push(this.c.node('param',at,{name,mutable,type:this.c.match(':')?this.type():null}));
          if(!this.c.match(','))break;
        }this.c.eat('|');
      }
      const returnType=this.c.match('->')?this.type():null;
      const body=returnType?this.block():this.expr();
      return this.c.node('closure',start,{move,params,returnType,body});
    }
    if (start.value === 'async' || start.value === 'unsafe')
      throw new Diagnostic('F0103', `${start.value} is not supported by the browser backend yet; use native Cargo`, start.span);
    return this.c.node('variable', start, {name: this.path()});
  }
}
