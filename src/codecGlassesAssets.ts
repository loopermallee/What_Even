export type CodecAssetKey =
  | 'frame-incoming'
  | 'frame-active'
  | 'frame-ended'
  | 'portrait-otacon'
  | 'portrait-snake';

const assetCache = new Map<CodecAssetKey, Uint8Array>();

type AssetDefinition = {
  width: number;
  height: number;
  svg: string;
};

function frameSvg(mode: 'incoming' | 'active' | 'ended') {
  const stroke = mode === 'ended' ? '#739d87' : '#a2ffd1';
  const glow = mode === 'ended' ? '#0d2119' : '#113126';
  const tag = mode === 'incoming' ? 'RING' : mode === 'active' ? 'LINK' : 'DONE';

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">
  <rect width="200" height="100" fill="#030705"/>
  <rect x="2" y="2" width="196" height="96" fill="none" stroke="${stroke}" stroke-width="2"/>
  <rect x="8" y="8" width="184" height="84" fill="none" stroke="${glow}" stroke-width="1"/>
  <line x1="36" y1="20" x2="164" y2="20" stroke="${stroke}" stroke-width="1"/>
  <line x1="36" y1="80" x2="164" y2="80" stroke="${stroke}" stroke-width="1"/>
  <rect x="70" y="11" width="60" height="12" fill="#0f251b" stroke="${stroke}" stroke-width="1"/>
  <text x="100" y="20" text-anchor="middle" fill="${stroke}" font-size="8" font-family="monospace">${tag}</text>
  <rect x="38" y="30" width="124" height="42" fill="#05130d" stroke="${stroke}" stroke-width="1"/>
  <rect x="46" y="39" width="44" height="24" fill="#a2ffd1" opacity="0.2"/>
  <rect x="42" y="74" width="116" height="6" fill="#0f251b" stroke="${stroke}" stroke-width="1"/>
</svg>`;
}

function portraitSvg(label: 'OT' | 'SN') {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <rect width="96" height="96" fill="#06130d"/>
  <rect x="1" y="1" width="94" height="94" fill="none" stroke="#a2ffd1" stroke-width="2"/>
  <rect x="5" y="5" width="86" height="86" fill="#0a2118"/>
  <ellipse cx="48" cy="40" rx="22" ry="18" fill="#93e7c1" opacity="0.28"/>
  <rect x="35" y="57" width="26" height="16" fill="#93e7c1" opacity="0.2"/>
  <text x="48" y="52" text-anchor="middle" fill="#c8ffe6" font-size="18" font-family="monospace">${label}</text>
</svg>`;
}

function getAssetDefinition(key: CodecAssetKey): AssetDefinition {
  if (key === 'frame-incoming') {
    return { width: 200, height: 100, svg: frameSvg('incoming') };
  }

  if (key === 'frame-active') {
    return { width: 200, height: 100, svg: frameSvg('active') };
  }

  if (key === 'frame-ended') {
    return { width: 200, height: 100, svg: frameSvg('ended') };
  }

  if (key === 'portrait-snake') {
    return { width: 96, height: 96, svg: portraitSvg('SN') };
  }

  return { width: 96, height: 96, svg: portraitSvg('OT') };
}

async function svgToPngBytes(svg: string, width: number, height: number) {
  const svgBlob = new Blob([svg], { type: 'image/svg+xml' });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load SVG asset into image.'));
      img.src = svgUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D context unavailable.');
    }

    context.drawImage(image, 0, 0, width, height);

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('PNG blob generation failed.'));
          return;
        }

        resolve(blob);
      }, 'image/png');
    });

    const bytes = new Uint8Array(await pngBlob.arrayBuffer());
    return bytes;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

export async function getCodecAssetBytes(key: CodecAssetKey) {
  const cached = assetCache.get(key);
  if (cached) {
    return cached;
  }

  const asset = getAssetDefinition(key);
  const bytes = await svgToPngBytes(asset.svg, asset.width, asset.height);
  assetCache.set(key, bytes);
  return bytes;
}
