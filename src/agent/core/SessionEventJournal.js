/** Bounded per-session audit recording, including tools and approvals emitted outside the harness. */
export class SessionEventJournal {
  constructor(events, sessions, {maxCharacters = 2_000_000, maxEvents = 1000} = {}) {
    this.sizes = new WeakMap(); this.unsubscribe = events.subscribe(event => {
      const session = sessions.get(event.sessionId); if (!session || event.type === 'model.delta') return;
      let entry = event, encoded = JSON.stringify(event);
      if (encoded.length > 32000) { entry = {sequence:event.sequence,at:event.at,type:event.type,sessionId:event.sessionId,callId:event.callId,name:event.name,truncated:true,preview:encoded.slice(0,16000)}; encoded = JSON.stringify(entry); }
      let size = this.sizes.get(session) ?? session.events.reduce((sum,item)=>sum+JSON.stringify(item).length,0);
      session.events.push(entry); size += encoded.length;
      while (session.events.length > 1 && (session.events.length > maxEvents || size > maxCharacters)) size -= JSON.stringify(session.events.shift()).length;
      this.sizes.set(session,size);
    });
  }
  close() { this.unsubscribe(); }
}
