export function renderSignalBars(level: number) {
  return Array.from({ length: 10 }, (_, index) => {
    const active = index < level;
    return `<div class="signal-bar ${active ? 'active' : ''}" style="height:${20 + index * 9}px"></div>`;
  }).join('');
}
