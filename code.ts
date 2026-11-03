// Free Screen Translator — canvas side (no network access here).
// Clones the selected frames, collects their text, hands unique strings to the
// UI iframe for translation, then writes the results back into the copies.

// ---------- Types shared with ui.html ----------

type Engine = 'mymemory' | 'libre';

interface Settings {
  from: string;
  to: string;
  engine: Engine;
  email: string;
  libreUrl: string;
  libreKey: string;
  skipHidden: boolean;
  swapFont: boolean;
  fixOverflow: boolean;
  glossary: string; // one term per line
}

interface Usage {
  date: string; // YYYY-MM-DD
  chars: number;
}

interface TranslateResult {
  translations: { [source: string]: string | null };
  charsSent: number;
  errors: string[];
}

const DEFAULT_SETTINGS: Settings = {
  from: 'en',
  to: 'hi',
  engine: 'mymemory',
  email: '',
  libreUrl: 'http://localhost:5000',
  libreKey: '',
  skipHidden: true,
  swapFont: true,
  fixOverflow: false,
  glossary: '',
};

const SETTINGS_KEY = 'settings';
const CACHE_KEY = 'cache-v1';
const USAGE_KEY = 'usage';
const MAX_CACHE_ENTRIES = 8000;

const LANG_NAMES: { [code: string]: string } = {
  en: 'English', hi: 'Hindi', mr: 'Marathi', ne: 'Nepali', bn: 'Bengali', ta: 'Tamil',
  te: 'Telugu', gu: 'Gujarati', pa: 'Punjabi', kn: 'Kannada', ml: 'Malayalam', ur: 'Urdu',
  ar: 'Arabic', fa: 'Persian', he: 'Hebrew', ja: 'Japanese', ko: 'Korean',
  'zh-CN': 'Chinese (Simplified)', 'zh-TW': 'Chinese (Traditional)', th: 'Thai',
  vi: 'Vietnamese', id: 'Indonesian', ms: 'Malay', tr: 'Turkish', ru: 'Russian',
  uk: 'Ukrainian', pl: 'Polish', cs: 'Czech', el: 'Greek', de: 'German', fr: 'French',
  es: 'Spanish', pt: 'Portuguese', it: 'Italian', nl: 'Dutch', sv: 'Swedish',
  da: 'Danish', fi: 'Finnish', no: 'Norwegian', ro: 'Romanian', hu: 'Hungarian',
};

// Font families for scripts that common Latin UI fonts don't cover.
const SCRIPT_FONTS: { [code: string]: string } = {
  hi: 'Noto Sans Devanagari', mr: 'Noto Sans Devanagari', ne: 'Noto Sans Devanagari',
  bn: 'Noto Sans Bengali', ta: 'Noto Sans Tamil', te: 'Noto Sans Telugu',
  gu: 'Noto Sans Gujarati', pa: 'Noto Sans Gurmukhi', kn: 'Noto Sans Kannada',
  ml: 'Noto Sans Malayalam', ja: 'Noto Sans JP', ko: 'Noto Sans KR',
  'zh-CN': 'Noto Sans SC', 'zh-TW': 'Noto Sans TC', th: 'Noto Sans Thai',
  ar: 'Noto Sans Arabic', fa: 'Noto Sans Arabic', ur: 'Noto Sans Arabic',
  he: 'Noto Sans Hebrew',
};

const RTL_LANGS = ['ar', 'fa', 'ur', 'he'];

const CLONE_GAP = 100;

// ---------- Storage helpers ----------

async function loadSettings(): Promise<Settings> {
  const saved = (await figma.clientStorage.getAsync(SETTINGS_KEY)) as Partial<Settings> | undefined;
  return Object.assign({}, DEFAULT_SETTINGS, saved || {});
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function loadUsage(): Promise<Usage> {
  const u = (await figma.clientStorage.getAsync(USAGE_KEY)) as Usage | undefined;
  if (!u || u.date !== today()) return { date: today(), chars: 0 };
  return u;
}

async function addUsage(chars: number): Promise<Usage> {
  const u = await loadUsage();
  u.chars += chars;
  await figma.clientStorage.setAsync(USAGE_KEY, u);
  return u;
}

type Cache = { [key: string]: string };

async function loadCache(): Promise<Cache> {
  return ((await figma.clientStorage.getAsync(CACHE_KEY)) as Cache | undefined) || {};
}

async function saveCache(cache: Cache): Promise<void> {
  const keys = Object.keys(cache);
  if (keys.length > MAX_CACHE_ENTRIES) {
    // Insertion order is preserved, so drop the oldest entries.
    for (const k of keys.slice(0, keys.length - MAX_CACHE_ENTRIES)) delete cache[k];
  }
  await figma.clientStorage.setAsync(CACHE_KEY, cache);
}

function cacheKey(from: string, to: string, text: string): string {
  return from + '|' + to + '|' + text;
}

// ---------- Selection ----------

type TranslatableRoot = FrameNode | ComponentNode | InstanceNode | GroupNode | SectionNode | ComponentSetNode;

function isRoot(node: SceneNode): node is TranslatableRoot {
  return ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'GROUP', 'SECTION'].indexOf(node.type) !== -1;
}

function selectedRoots(): TranslatableRoot[] {
  return figma.currentPage.selection.filter(isRoot);
}

function postSelection(): void {
  const roots = selectedRoots();
  figma.ui.postMessage({
    type: 'selection',
    count: roots.length,
    names: roots.map((r) => r.name),
  });
}

// ---------- Text collection ----------

function collectTextNodes(root: SceneNode, skipHidden: boolean): TextNode[] {
  const out: TextNode[] = [];
  const walk = (node: SceneNode) => {
    if (skipHidden && !node.visible) return;
    if (node.type === 'TEXT') {
      out.push(node);
      return;
    }
    if ('children' in node) {
      for (const child of node.children) walk(child);
    }
  };
  walk(root);
  return out;
}

/** Text worth sending to a translator: has at least one letter. */
function isTranslatable(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // Pure placeholders like {{name}} or numbers/symbols are left untouched.
  const withoutPlaceholders = t.replace(/\{\{[^}]*\}\}/g, '').replace(/\{[^}]*\}/g, '');
  return /\p{L}/u.test(withoutPlaceholders);
}

// ---------- Fonts ----------

let availableFonts: Font[] | null = null;

async function getAvailableFonts(): Promise<Font[]> {
  if (!availableFonts) availableFonts = await figma.listAvailableFontsAsync();
  return availableFonts;
}

const loadedFonts = new Set<string>();

async function loadFont(font: FontName): Promise<boolean> {
  const key = font.family + '::' + font.style;
  if (loadedFonts.has(key)) return true;
  try {
    await figma.loadFontAsync(font);
    loadedFonts.add(key);
    return true;
  } catch (e) {
    return false;
  }
}

/** Pick a script font for `lang`, keeping the original weight where possible. */
async function scriptFontFor(lang: string, original: FontName): Promise<FontName | null> {
  const family = SCRIPT_FONTS[lang];
  if (!family || original.family === family) return null;
  const fonts = await getAvailableFonts();
  const styles = fonts.filter((f) => f.fontName.family === family).map((f) => f.fontName.style);
  if (styles.length === 0) return null;
  const want = original.style;
  const pick =
    styles.find((s) => s === want) ||
    styles.find((s) => s.replace(/\s+/g, '').toLowerCase() === want.replace(/\s+/g, '').toLowerCase()) ||
    styles.find((s) => s === 'Regular') ||
    styles[0];
  return { family, style: pick };
}

// ---------- Writing ----------

interface NodeReport {
  name: string;
  issue: string;
}

interface WriteContext {
  to: string;
  swapFont: boolean;
  fixOverflow: boolean;
  issues: NodeReport[];
  fontSwaps: Set<string>;
  missingFonts: Set<string>;
}

async function writeText(node: TextNode, translated: string, ctx: WriteContext): Promise<boolean> {
  const segments = node.getStyledTextSegments([
    'fontName', 'fontSize', 'fills', 'textDecoration', 'textCase', 'letterSpacing', 'lineHeight',
  ]);
  if (segments.length === 0) return false;

  // Every font currently in the node must be loaded before characters can change.
  for (const seg of segments) {
    if (!(await loadFont(seg.fontName))) {
      ctx.missingFonts.add(seg.fontName.family + ' ' + seg.fontName.style);
      ctx.issues.push({ name: node.name, issue: 'font not available: ' + seg.fontName.family + ' ' + seg.fontName.style });
      return false;
    }
  }

  const first = segments[0];
  let font: FontName = first.fontName;
  if (ctx.swapFont) {
    const swap = await scriptFontFor(ctx.to, first.fontName);
    if (swap && (await loadFont(swap))) {
      font = swap;
      ctx.fontSwaps.add(first.fontName.family + ' → ' + swap.family + ' ' + swap.style);
    }
  }

  const fixedSize = node.textAutoResize === 'NONE' || node.textAutoResize === 'TRUNCATE';
  const originalHeight = node.height;

  node.characters = translated;

  const len = node.characters.length;
  if (len > 0) {
    // v1: mixed styles collapse to the first segment's style.
    node.setRangeFontName(0, len, font);
    node.setRangeFontSize(0, len, first.fontSize);
    node.setRangeFills(0, len, first.fills);
    node.setRangeTextDecoration(0, len, first.textDecoration);
    node.setRangeTextCase(0, len, first.textCase);
    node.setRangeLetterSpacing(0, len, first.letterSpacing);
    node.setRangeLineHeight(0, len, first.lineHeight);
  }
  if (segments.length > 1) {
    ctx.issues.push({ name: node.name, issue: 'mixed styles — first style applied to all text' });
  }

  if (RTL_LANGS.indexOf(ctx.to) !== -1 && node.textAlignHorizontal === 'LEFT') {
    node.textAlignHorizontal = 'RIGHT';
  }

  if (fixedSize) {
    // Measure the height the new text needs using a throwaway copy.
    const probe = node.clone();
    probe.textAutoResize = 'HEIGHT';
    const needed = probe.height;
    probe.remove();
    if (needed > originalHeight + 1) {
      if (ctx.fixOverflow) {
        node.textAutoResize = 'HEIGHT';
        ctx.issues.push({ name: node.name, issue: 'overflowed fixed box — switched to auto-height' });
      } else {
        ctx.issues.push({ name: node.name, issue: 'text overflows its fixed-size box' });
      }
    }
  }
  return true;
}

// ---------- Run ----------

interface Job {
  settings: Settings;
  clones: { clone: TranslatableRoot; nodes: TextNode[] }[];
  strings: string[];
  cache: Cache;
}

let currentJob: Job | null = null;

function langLabel(code: string): string {
  return (LANG_NAMES[code] || code) + ' (' + code + ')';
}

async function startRun(settings: Settings): Promise<void> {
  const roots = selectedRoots();
  if (roots.length === 0) {
    figma.ui.postMessage({ type: 'error', message: 'Select at least one frame to translate.' });
    return;
  }
  if (settings.from === settings.to) {
    figma.ui.postMessage({ type: 'error', message: 'From and To languages are the same.' });
    return;
  }
  await figma.clientStorage.setAsync(SETTINGS_KEY, settings);

  // Offset all copies by the selection's total width so a row of frames stays
  // a row and copies never land on top of other selected frames.
  let minX = Infinity;
  let maxX = -Infinity;
  for (const r of roots) {
    minX = Math.min(minX, r.x);
    maxX = Math.max(maxX, r.x + r.width);
  }
  const offset = maxX - minX + CLONE_GAP;

  const clones: Job['clones'] = [];
  const newSelection: SceneNode[] = [];
  for (const root of roots) {
    const clone = root.clone() as TranslatableRoot;
    clone.x = root.x + offset;
    clone.y = root.y;
    clone.name = root.name + ' — ' + langLabel(settings.to);
    clones.push({ clone, nodes: collectTextNodes(clone, settings.skipHidden) });
    newSelection.push(clone);
  }
  figma.currentPage.selection = newSelection;

  const unique = new Set<string>();
  for (const c of clones) {
    for (const n of c.nodes) {
      if (isTranslatable(n.characters)) unique.add(n.characters);
    }
  }
  const strings = Array.from(unique);
  const cache = await loadCache();

  const cached: { [s: string]: string } = {};
  const missing: string[] = [];
  for (const s of strings) {
    const hit = cache[cacheKey(settings.from, settings.to, s)];
    if (hit !== undefined) cached[s] = hit;
    else missing.push(s);
  }

  currentJob = { settings, clones, strings, cache };

  figma.ui.postMessage({
    type: 'translate',
    from: settings.from,
    to: settings.to,
    missing,
    cachedCount: strings.length - missing.length,
    cached,
  });
}

async function finishRun(result: TranslateResult): Promise<void> {
  const job = currentJob;
  currentJob = null;
  if (!job) return;
  const { settings, clones, cache } = job;

  // Persist new translations first so a rerun after a failure is cheap.
  for (const src of Object.keys(result.translations)) {
    const t = result.translations[src];
    if (t !== null && t !== undefined) cache[cacheKey(settings.from, settings.to, src)] = t;
  }
  await saveCache(cache);
  const usage = await addUsage(result.charsSent);

  const ctx: WriteContext = {
    to: settings.to,
    swapFont: settings.swapFont,
    fixOverflow: settings.fixOverflow,
    issues: [],
    fontSwaps: new Set(),
    missingFonts: new Set(),
  };

  let written = 0;
  let failed = 0;
  let skipped = 0;
  const frames: { name: string; partial: boolean }[] = [];

  for (const { clone, nodes } of clones) {
    let partial = false;
    for (const node of nodes) {
      const src = node.characters;
      if (!isTranslatable(src)) {
        skipped++;
        continue;
      }
      const t = result.translations[src];
      if (t === null || t === undefined) {
        failed++;
        partial = true;
        continue;
      }
      if (t === src) {
        written++;
        continue;
      }
      try {
        if (await writeText(node, t, ctx)) written++;
        else {
          failed++;
          partial = true;
        }
      } catch (e) {
        failed++;
        partial = true;
        ctx.issues.push({ name: node.name, issue: 'could not write: ' + String(e) });
      }
    }
    if (partial) clone.name = clone.name + ' — partial';
    frames.push({ name: clone.name, partial });
  }

  figma.ui.postMessage({
    type: 'report',
    frames,
    written,
    failed,
    skipped,
    uniqueStrings: job.strings.length,
    charsSent: result.charsSent,
    usage,
    errors: result.errors,
    issues: ctx.issues.slice(0, 200),
    issueCount: ctx.issues.length,
    fontSwaps: Array.from(ctx.fontSwaps),
    missingFonts: Array.from(ctx.missingFonts),
  });
  figma.notify(
    failed > 0
      ? 'Translated ' + written + ' text layers, ' + failed + ' failed (marked partial).'
      : 'Translated ' + written + ' text layers.'
  );
}

// ---------- Boot ----------

figma.showUI(__html__, { width: 340, height: 600, themeColors: true });

figma.on('selectionchange', postSelection);

figma.ui.onmessage = async (msg: any) => {
  try {
    switch (msg.type) {
      case 'init': {
        const [settings, usage] = await Promise.all([loadSettings(), loadUsage()]);
        figma.ui.postMessage({ type: 'init', settings, usage, languages: LANG_NAMES });
        postSelection();
        break;
      }
      case 'save-settings':
        await figma.clientStorage.setAsync(SETTINGS_KEY, msg.settings);
        break;
      case 'start':
        figma.skipInvisibleInstanceChildren = !!msg.settings.skipHidden;
        await startRun(msg.settings as Settings);
        break;
      case 'translated':
        await finishRun(msg.result as TranslateResult);
        break;
      case 'clear-cache':
        await figma.clientStorage.setAsync(CACHE_KEY, {});
        figma.notify('Translation cache cleared.');
        break;
      case 'close':
        figma.closePlugin();
        break;
    }
  } catch (e) {
    currentJob = null;
    figma.ui.postMessage({ type: 'error', message: String(e) });
  }
};
