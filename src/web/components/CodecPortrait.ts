export function renderCodecPortrait(options: {
  label: string;
  tag: string;
  active: boolean;
  mouthOpen: boolean;
}) {
  return `
    <div class="portrait-frame ${options.active ? 'active' : ''}">
      <div class="portrait-label">${options.label}</div>
      <div class="portrait-face">
        <div class="portrait-silhouette">${options.tag}</div>
        <div class="mouth-slot ${options.mouthOpen ? 'open' : ''}">
          <div class="mouth-core"></div>
        </div>
      </div>
    </div>
  `;
}
