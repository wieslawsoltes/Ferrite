/** Monotonic, bounded replay log. Slow/reconnecting observers receive an explicit gap. */
export class EventLog {
  constructor({limit = 2000, maxCharacters = 2_000_000} = {}) {
    this.limit = limit; this.maxCharacters = maxCharacters; this.entries = []; this.sequence = 0; this.characters = 0; this.listeners = new Set();
  }
  emit(type, data = {}) {
    const event = {...data, sequence: ++this.sequence, at: new Date().toISOString(), type};
    const size = JSON.stringify(event).length;
    this.entries.push({event, size}); this.characters += size;
    while (this.entries.length > 1 && (this.entries.length > this.limit || this.characters > this.maxCharacters)) this.characters -= this.entries.shift().size;
    for (const listener of this.listeners) { try { listener(event); } catch { /* Observers cannot break the producer. */ } }
    return event;
  }
  read(after = 0) {
    if (!Number.isSafeInteger(after) || after < 0) throw Error('Invalid event cursor');
    const first = this.entries[0]?.event.sequence ?? this.sequence + 1;
    return {events: this.entries.filter(({event}) => event.sequence > after).map(({event}) => event), cursor: this.sequence, gap: after > this.sequence || after < first - 1};
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
}
