export function renderDebugLog(lines: string[]) {
  return `
    <div class="log-card">
      <div class="log-header">
        <span>Log</span>
      </div>
      <pre id="log" class="log">${lines.join('\n')}</pre>
    </div>
  `;
}
