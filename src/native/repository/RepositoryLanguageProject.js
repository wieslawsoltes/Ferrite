/** LSP text overlays borrow the real checkout; hovering never writes or deletes local sources. */
export class RepositoryLanguageProject {
  constructor(session) { this.session = session; this.root = session.root; this.previous = new Map(); }
  get manifest() { return this.session.manifest; }
  async update(snapshot) { this.previous = new Map(Object.entries(snapshot.files)); }
  async dispose() { this.previous.clear(); }
}
