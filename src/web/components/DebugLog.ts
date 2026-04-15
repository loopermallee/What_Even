function escapeHtml(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

type DebugLogOptions = {
  title?: string;
  className?: string;
  emptyLabel?: string;
};

export function renderDebugLog(lines: string[], options: DebugLogOptions = {}) {
  const {
    title = 'Log',
    className = 'log-card',
    emptyLabel = 'No log lines yet.',
  } = options;
  const body = lines.length > 0
    ? lines.map((line) => escapeHtml(line)).join('\n')
    : escapeHtml(emptyLabel);

  return `
    <div class="${className}">
      <div class="log-header">
        <span>${escapeHtml(title)}</span>
      </div>
      <pre id="log" class="log">${body}</pre>
    </div>
  `;
}
