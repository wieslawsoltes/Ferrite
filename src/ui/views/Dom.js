/** DOM construction and the IDE's original, inline vector icon set. */
export class Dom {
  static element(tag, className = '', text = '') {
    const node = document.createElement(tag); if (className) node.className = className; if (text !== '') node.textContent = String(text); return node;
  }
  static button(label, action, {icon = null, className = '', title = label} = {}) {
    const button = this.element('button', className); button.type = 'button'; button.title = title; button.setAttribute('aria-label', label);
    if (icon) button.append(this.icon(icon)); if (label) button.append(this.element('span', '', label)); if (action) button.addEventListener('click', action); return button;
  }
  static icon(name) {
    const paths = {
      run:'M6 3.5 16 10 6 16.5Z', stop:'M5 5h10v10H5Z', check:'m4 10 4 4 8-9', build:'m12 3-3 3 5 5 3-3 M9 6 3 12l5 5 6-6 M3 12l5 5',
      debug:'M7 6h6v9H7Z M8 3h4v3 M4 7h3m6 0h3M3 11h4m6 0h4M4 15h3m6 0h3M10 7v7', test:'m7 2 1 8-4 6v2h12v-2l-4-6 1-8 M6 2h8 M7 12h6',
      folder:'M2 5h6l2 2h8v10H2Z', code:'m7 5-5 5 5 5m6-10 5 5-5 5M11 3 9 17', file:'M5 2h7l4 4v12H5Z M12 2v5h4',
      cargo:'m3 6 7-4 7 4v8l-7 4-7-4Z M3 6l7 4 7-4M10 10v8M6.5 4 13 8', search:'M13.5 13.5 18 18 M15 8.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0',
      plus:'M10 4v12M4 10h12', close:'m5 5 10 10M15 5 5 15', down:'m5 7 5 5 5-5', right:'m7 5 5 5-5 5',
      settings:'M3 6h14M3 14h14M7 3v6M13 11v6', reset:'M4 7a7 7 0 1 1-1 6M4 2v5h5', export:'M10 2v11m-4-4 4 4 4-4M3 13v5h14v-5',
      import:'M10 14V3m-4 4 4-4 4 4M3 13v5h14v-5', save:'M3 2h12l3 3v13H3Z M6 2v6h8V2 M6 18v-7h9v7',
      console:'m3 5 5 5-5 5M10 15h7', tree:'M10 3v4M4 8h12M4 8v4m12-4v4M2 13h5v4H2ZM13 13h5v4h-5ZM8 1h5v4H8Z',
      chart:'M3 17V3m0 14h15M6 14v-4m4 4V6m4 8V2', warning:'m10 2 9 16H1Z M10 7v5m0 2v1',
      pause:'M6 3v14M14 3v14', step:'m3 5 7 5-7 5ZM14 4v12', line:'M4 5h11l-4-3m4 3-4 3M3 14h13m-3-3 3 3-3 3',
      split:'M2 3h16v14H2ZM10 3v14', grip:'M7 5h.01M13 5h.01M7 10h.01M13 10h.01M7 15h.01M13 15h.01',
      connect:'m7 4 9 9M4 7l9 9M8 3 3 8l9 9 5-5M2 18l4-4M14 6l4-4', menu:'M3 5h14M3 10h14M3 15h14',
      fit:'M2 7V2h5m6 0h5v5m0 6v5h-5m-6 0H2v-5', minus:'M4 10h12', trash:'M3 5h14M7 5V2h6v3M5 5l1 13h9l1-13M8 8v7m4-7v7'
    };
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('viewBox','0 0 20 20'); svg.setAttribute('aria-hidden','true'); svg.classList.add('icon');
    const path = document.createElementNS(svg.namespaceURI,'path'); path.setAttribute('d',paths[name] ?? paths.file); svg.append(path); return svg;
  }
  static escape(value) { return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'); }
  static sourceLabel(span) { return span ? `${span.file}:${span.line ?? 1}:${span.column ?? 1}` : 'No source location'; }
  static empty(root, text) { root.replaceChildren(this.element('div','empty-state',text)); }
}
