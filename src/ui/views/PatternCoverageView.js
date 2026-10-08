import {Dom} from './Dom.js';

/** Displays coverage proofs emitted by the pattern-specialization pass. */
export class PatternCoverageView {
  constructor(root, registry) { this.root = root; this.registry = registry; }

  render(reports) {
    const summary = Dom.element('p', 'view-note', `${reports.length} pattern proofs · constructor matrices and integer interval partitions`);
    this.root.append(summary);
    for (const report of reports) {
      const card = Dom.element('section', `inspection-card ${report.exhaustive ? 'success' : 'warning'}`);
      const title = Dom.element('div', 'card-heading', `${report.type} · ${report.exhaustive ? 'exhaustive' : 'refutable'}`);
      this.registry.bind(title, report.span);
      card.append(title, Dom.element('p', 'card-detail', `${report.states} proof states · ${Dom.sourceLabel(report.span)}`));
      if (report.witness !== null) card.append(Dom.element('code', 'type-bindings', `Unmatched witness: ${report.witness}`));
      this.root.append(card);
    }
  }
}
