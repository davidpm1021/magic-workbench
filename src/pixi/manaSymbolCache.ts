import { Texture } from "pixi.js";
import { platformFetch } from "@/lib/platformFetch";
import { manaSymbolUrl, normalizeManaCode } from "@/api/scryfall";
import { getTheme } from "@/hooks/useTheme";
import { MANA_LETTERS, type ManaLetter } from "@/themes/gameTheme";
import { rasterizeSvgTexture } from "./assets/rasterizeSvgTexture";
// Rasterize SVGs into a fixed-size canvas so Pixi gets a concrete texture
// (SVGs decoded into HTMLImageElement can have zero intrinsic dimensions).
const SYMBOL_RASTER_SIZE = 96;

const textures = new Map<string, Texture>();
const loading = new Map<string, Promise<Texture>>();
let cacheGeneration = 0;

async function fetchSvgText(symbol: string): Promise<string> {
  const code = normalizeManaCode(symbol);
  if (!code) throw new Error(`unsupported mana symbol: ${symbol}`);
  const url = manaSymbolUrl(code);
  const response = await platformFetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return await response.text();
}

function fallbackSymbolTexture(symbol: string): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = SYMBOL_RASTER_SIZE;
  canvas.height = SYMBOL_RASTER_SIZE;
  const context = canvas.getContext("2d");
  if (!context) return Texture.EMPTY;

  const code = normalizeManaCode(symbol);
  const theme = getTheme().gameTheme;
  const manaLetter =
    code && MANA_LETTERS.includes(code as ManaLetter) ? (code as ManaLetter) : null;
  const background = manaLetter ? theme.mana[manaLetter] : theme.canvas.neutral;
  const label = (code ?? symbol).replaceAll("/", "");

  context.fillStyle = background;
  context.beginPath();
  context.arc(
    SYMBOL_RASTER_SIZE / 2,
    SYMBOL_RASTER_SIZE / 2,
    SYMBOL_RASTER_SIZE / 2 - 4,
    0,
    Math.PI * 2,
  );
  context.fill();

  context.fillStyle = theme.textOnTinted;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `700 ${label.length > 2 ? 24 : 38}px sans-serif`;
  context.fillText(label, SYMBOL_RASTER_SIZE / 2, SYMBOL_RASTER_SIZE / 2 + 1);

  return new Texture({ source: new ImageSource({ resource: canvas }) });
}

async function loadSymbolTexture(symbol: string): Promise<Texture> {
  try {
    const svgText = await fetchSvgText(symbol);
    return await rasterizeSvgTexture(svgText, SYMBOL_RASTER_SIZE);
  } catch {
    return fallbackSymbolTexture(symbol);
  }
}

export function getManaSymbolTextureSync(symbol: string): Texture | null {
  const cached = textures.get(symbol);
  return cached && !cached.destroyed ? cached : null;
}

export function loadManaSymbolTexture(symbol: string): Promise<Texture> {
  const cached = getManaSymbolTextureSync(symbol);
  if (cached) return Promise.resolve(cached);
  const pending = loading.get(symbol);
  if (pending) return pending;

  const generation = cacheGeneration;
  const promise = loadSymbolTexture(symbol)
    .then((texture) => {
      if (generation === cacheGeneration) textures.set(symbol, texture);
      return texture;
    })
    .finally(() => {
      if (loading.get(symbol) === promise) loading.delete(symbol);
    });
  loading.set(symbol, promise);
  return promise;
}

/** Pre-warm the five colors, colorless, plus tap/untap so first hover
 * renders from cache. Scryfall hosts all card symbols at the same path.
 */
export function prewarmManaSymbols(): void {
  for (const s of ["W", "U", "B", "R", "G", "C", "T", "Q"]) {
    loadManaSymbolTexture(s).catch((err) =>
      console.warn(`[pixi] card symbol load failed for {${s}}:`, err),
    );
  }
}

export function clearManaSymbolCache(): void {
  cacheGeneration += 1;
  for (const tex of textures.values()) tex.destroy(true);
  textures.clear();
  loading.clear();
}
