/** rust-analyzer observes the existing checkout, including .cargo config and path dependencies.
 * Unlike ProjectMaterializer, this adapter must never rewrite or remove the selected project.
 */
export class PersistentLanguageProject {
  constructor(root) { this.root = root; this.previous = new Map(); }
  async update(snapshot) { this.previous = new Map(Object.entries(snapshot.files)); }
  async dispose() { this.previous.clear(); }
}
