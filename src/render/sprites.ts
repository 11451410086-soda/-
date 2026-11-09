/** 像素精灵：用字符画定义，启动时烘焙成 canvas，零图片资源 */

export interface SpriteDef {
  rows: string[];
  pal: Record<string, string>;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, w);
  cv.height = Math.max(1, h);
  return cv;
}

export function bake(def: SpriteDef): HTMLCanvasElement {
  const rows = def.rows;
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  const cv = makeCanvas(w, h);
  const g = cv.getContext('2d')!;
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    const off = Math.floor((w - row.length) / 2);
    for (let x = 0; x < row.length; x++) {
      const col = def.pal[row[x]];
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(off + x, y, 1, 1);
    }
  }
  return cv;
}

/** 生成纯色剪影，用于受击闪白 */
export function silhouette(src: HTMLCanvasElement, color = '#ffffff'): HTMLCanvasElement {
  const cv = makeCanvas(src.width, src.height);
  const g = cv.getContext('2d')!;
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, cv.width, cv.height);
  return cv;
}

/** 程序生成水晶（不上图片，不手数字符） */
export function makeCrystal(
  w: number,
  h: number,
  colors: { edge: string; light: string; mid: string; dark: string },
): HTMLCanvasElement {
  const cv = makeCanvas(w, h);
  const g = cv.getContext('2d')!;
  const cx = (w - 1) / 2;
  const midY = h * 0.4;
  for (let y = 0; y < h; y++) {
    let half: number;
    if (y < midY) {
      half = 0.6 + (y / midY) * (w / 2 - 0.6);
    } else {
      half = (w / 2) * (1 - (y - midY) / (h - midY));
    }
    half = Math.max(0, half);
    const x0 = Math.round(cx - half);
    const x1 = Math.round(cx + half);
    const span = Math.max(1, x1 - x0);
    for (let x = x0; x <= x1; x++) {
      const t = (x - x0) / span;
      let col: string;
      if (x === x0 || x === x1) col = colors.edge;
      else if (t < 0.4) col = colors.light;
      else if (t < 0.72) col = colors.mid;
      else col = colors.dark;
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  }
  // 顶部高光
  g.fillStyle = colors.light;
  for (let i = -1; i <= 1; i++) g.fillRect(Math.round(cx) + i, 1, 1, 1);
  return cv;
}

export interface Sprite {
  img: HTMLCanvasElement;
  flash: HTMLCanvasElement;
  w: number;
  h: number;
}

function toSprite(img: HTMLCanvasElement): Sprite {
  return { img, flash: silhouette(img), w: img.width, h: img.height };
}

/* ---------------- 角色 ---------------- */

const HERO_DEF: SpriteDef = {
  rows: [
    "......kkkk......",
    ".....kmmmmk.....",
    "....kmmmmmmk....",
    "...kmmwwwwmmk...",
    "...kmwwggwwmk...",
    "...kmwwwwwwmk...",
    "....kmmmmmmk....",
    "..kkbbbbbbbbkk..",
    "..kbbbbbbbbbbk..",
    ".kbbbbbbbbbbbbk.",
    ".kbbbbbbbbbbbbk.",
    ".kbbbbbbbbbbbbk.",
    "..kbbbbbbbbbbk..",
    "..kkbbbbbbbbkk..",
    "...kkbbbbbbkk...",
    "....kk.kk.kk....",
    "....kk.kk.kk....",
    ".....k...k......",
  ],
  pal: {
    k: "#05080e",
    m: "#9fb0c4",
    w: "#e8f2ff",
    g: "#6ff0e0",
    b: "#3d5470",
  },
};

const PUZE_DEF: SpriteDef = {
  rows: [
    '....kk....kk....',
    '...kcck..kcck...',
    '...kcckkkkcck...',
    '....kcccccck....',
    '...kcwwwwwwck...',
    '...kcwggggwck...',
    '...kcwwwwwwck...',
    '....kcccccck....',
    '...kcccccccck...',
    '..kcccccccccck..',
    '..kcckcccckcck..',
    '..kck.kcck.kck..',
    '..kk..kcck..kk..',
    '......kcck......',
    '.....kk..kk.....',
    '.....kk..kk.....',
    '......k..k......',
  ],
  pal: {
    k: '#060b10',
    c: '#2a8f7f',
    w: '#d8fff0',
    g: '#ffd166',
  },
};


/** 陨主：重甲 + 盾牌 */
export const GUARD_SPRITE = toSprite(bake(HERO_DEF));
export const PUZE_SPRITE = toSprite(bake(PUZE_DEF));


const SHIQIA_DEF: SpriteDef = {
  rows: [
    "...kkkkkk...",
    "..kmmmmmmk..",
    ".kmmggggmmk.",
    ".kmmmmmmmmk.",
    "..kbbbbbbk..",
    ".kbbbbbbbbk.",
    ".kbbbbbbbbk.",
    "..kbbbbbbk..",
    "...kk..kk...",
    "..kk....kk..",
  ],
  pal: {
    k: "#0b0f18",
    m: "#7f6ea8",
    g: "#ffd166",
    b: "#4a3f6b",
  },
};

export const SHIQIA_SPRITE = toSprite(bake(SHIQIA_DEF));

const YUEJI_DEF: SpriteDef = {
  rows: [
    "..kkkkkkkk..",
    ".kmmmmmmmmk.",
    "kmmggggggmmk",
    "kmmmmmmmmmmk",
    ".kbbbbbbbbk.",
    ".kbbbbbbbbk.",
    ".kbbbbbbbbk.",
    ".kbbbbbbbbk.",
    "..kbbbbbbk..",
    "..kk.kk.kk..",
  ],
  pal: {
    k: "#0b0f18",
    m: "#6f8fa8",
    g: "#8ef0c0",
    b: "#2f4658",
  },
};

const QULIN_DEF: SpriteDef = {
  rows: [
    "...kkkkkk...",
    "..kmmmmmmk..",
    ".kmmggggmmk.",
    ".kmmmmmmmmk.",
    "..kbbbbbbk..",
    ".kbbbbbbbbk.",
    ".kbbbbbbbbk.",
    "..kbbbbbbk..",
    "...kk..kk...",
    "..kk....kk..",
  ],
  pal: {
    k: "#0b0f18",
    m: "#a8d8a0",
    g: "#ffe08a",
    b: "#3f5a3c",
  },
};

export const YUEJI_SPRITE = toSprite(bake(YUEJI_DEF));
export const QULIN_SPRITE = toSprite(bake(QULIN_DEF));

export const PURIFY_SPRITE = toSprite(
  makeCrystal(14, 20, {
    edge: '#0e3a44',
    light: '#e8fdff',
    mid: '#5fd7ff',
    dark: '#2a8fa8',
  }),
);

export const ASCENSION_SPRITE = toSprite(
  makeCrystal(20, 30, {
    edge: '#5a3a0a',
    light: '#fff8e0',
    mid: '#ffd166',
    dark: '#c98a1e',
  }),
);

/* ---------------- 发光贴图 ---------------- */

const glowCache = new Map<string, HTMLCanvasElement>();

export function glowTex(color: string, radius: number): HTMLCanvasElement {
  const key = color + '|' + radius;
  const hit = glowCache.get(key);
  if (hit) return hit;
  const size = radius * 2;
  const cv = makeCanvas(size, size);
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(radius, radius, 0, radius, radius, radius);
  grad.addColorStop(0, color);
  grad.addColorStop(0.25, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  glowCache.set(key, cv);
  return cv;
}
