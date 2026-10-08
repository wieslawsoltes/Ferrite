export class CompilerCache {
  constructor(limit=32) { this.limit=limit; this.entries=new Map(); this.hits=0; this.misses=0; }
  get(key) {
    if (!this.entries.has(key)) { this.misses++; return undefined; }
    const value=this.entries.get(key);this.entries.delete(key);this.entries.set(key,value);this.hits++;return value;
  }
  set(key,value) { this.entries.delete(key);this.entries.set(key,value);if(this.entries.size>this.limit)this.entries.delete(this.entries.keys().next().value);return value; }
  clear(){this.entries.clear();this.hits=0;this.misses=0;}
  get stats(){return {hits:this.hits,misses:this.misses,entries:this.entries.size};}
}
