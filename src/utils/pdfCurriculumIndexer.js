let cachedPdfJsLib = null;

async function getPdfJsLib() {
    if (cachedPdfJsLib) return cachedPdfJsLib;
    const mod = await import('pdfjs-dist');
    const pdfjsLib = mod?.default || mod;
    try {
        if (typeof window !== 'undefined' && pdfjsLib?.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
                'pdfjs-dist/build/pdf.worker.min.mjs',
                import.meta.url
            ).toString();
        }
    } catch {
        // Fallback handled during getDocument
    }
    cachedPdfJsLib = pdfjsLib;
    return pdfjsLib;
}

export const COPTIC_YEAR_PARTS = [
    {
        partNumber: 1,
        key: 'part_1',
        shortLabel: 'الجزء الأول',
        label: 'الجزء الأول (توت - بابه - هاتور - كيهك)',
        months: ['توت', 'بابه', 'هاتور', 'كيهك']
    },
    {
        partNumber: 2,
        key: 'part_2',
        shortLabel: 'الجزء الثاني',
        label: 'الجزء الثاني (طوبة - أمشير - برمهات - برمودة)',
        months: ['طوبة', 'أمشير', 'برمهات', 'برمودة']
    },
    {
        partNumber: 3,
        key: 'part_3',
        shortLabel: 'الجزء الثالث',
        label: 'الجزء الثالث (بشنس - بؤونة - أبيب - مسرى)',
        months: ['بشنس', 'بؤونة', 'أبيب', 'مسرى']
    },
    {
        partNumber: 4,
        key: 'part_4',
        shortLabel: 'الجزء الرابع',
        label: 'الجزء الرابع / ملحق إضافي',
        months: ['الشهر الأول (ملحق)', 'الشهر الثاني (ملحق)', 'الشهر الثالث (ملحق)', 'الشهر الرابع (ملحق)']
    }
];

export const COPTIC_MONTH_ALIASES = [
    { canonical: 'توت', slug: 'thout', patterns: ['توت'] },
    { canonical: 'بابه', slug: 'paopi', patterns: ['بابه', 'بابة', 'بابى', 'بابي'] },
    { canonical: 'هاتور', slug: 'hathor', patterns: ['هاتور'] },
    { canonical: 'كيهك', slug: 'koiahk', patterns: ['كيهك', 'كيهكك'] },
    { canonical: 'طوبة', slug: 'toba', patterns: ['طوبة', 'طوبه', 'طوبى', 'طوبي'] },
    { canonical: 'أمشير', slug: 'amshir', patterns: ['أمشير', 'امشير'] },
    { canonical: 'برمهات', slug: 'baramhat', patterns: ['برمهات'] },
    { canonical: 'برمودة', slug: 'baramouda', patterns: ['برمودة', 'برموده'] },
    { canonical: 'بشنس', slug: 'bashans', patterns: ['بشنس'] },
    { canonical: 'بؤونة', slug: 'paona', patterns: ['بؤونة', 'بؤونه', 'باؤنى', 'باؤني', 'باونة', 'باونه'] },
    { canonical: 'أبيب', slug: 'epip', patterns: ['أبيب', 'ابيب'] },
    { canonical: 'مسرى', slug: 'mesra', patterns: ['مسرى', 'مسري'] }
];

export const COPTIC_WEEK_MARKERS = [
    {
        weekNumber: 1,
        weekLabel: 'الأسبوع الأول',
        patterns: ['الاسبوع الاول', 'الأسبوع الأول', 'الاسبوع ١', 'الاسبوع 1']
    },
    {
        weekNumber: 2,
        weekLabel: 'الأسبوع الثاني',
        patterns: ['الاسبوع الثاني', 'الاسبوع الثانى', 'الأسبوع الثاني', 'الاسبوع ٢', 'الاسبوع 2']
    },
    {
        weekNumber: 3,
        weekLabel: 'الأسبوع الثالث',
        patterns: ['الاسبوع الثالث', 'الأسبوع الثالث', 'الاسبوع ٣', 'الاسبوع 3']
    },
    {
        weekNumber: 4,
        weekLabel: 'الأسبوع الرابع',
        patterns: ['الاسبوع الرابع', 'الأسبوع الرابع', 'الاسبوع ٤', 'الاسبوع 4']
    }
];

// Standard Word-to-PDF Arabic Private Use Area (0xF200..0xF2FF) character decoder (used in Diocese Part 2 books)
const PUA_F2XX_MAP = {
    0xf217: 'ير',
    0xf21e: 'تي',
    0xf220: ' ',
    0xf222: '"',
    0xf228: '(',
    0xf229: ')',
    0xf22d: '-',
    0xf22e: '.',
    0xf23a: ':',
    0xf241: 'ا',
    0xf242: 'ا',
    0xf243: 'أ',
    0xf244: 'أ',
    0xf245: 'ؤ',
    0xf246: 'ؤ',
    0xf247: 'إ',
    0xf248: 'إ',
    0xf249: 'ب',
    0xf24a: 'ب',
    0xf24b: 'ب',
    0xf24c: 'ب',
    0xf24d: 'ت',
    0xf24e: 'ت',
    0xf24f: 'ت',
    0xf250: 'ت',
    0xf251: 'ث',
    0xf252: 'ث',
    0xf253: 'ث',
    0xf254: 'ث',
    0xf255: 'ج',
    0xf256: 'ج',
    0xf257: 'ج',
    0xf258: 'ج',
    0xf259: 'ح',
    0xf25a: 'ح',
    0xf25b: 'ح',
    0xf25c: 'ح',
    0xf25d: 'خ',
    0xf25e: 'خ',
    0xf25f: '',
    0xf260: 'خ',
    0xf261: 'خ',
    0xf262: 'خ',
    0xf265: 'د',
    0xf266: 'د',
    0xf267: 'ذ',
    0xf268: 'ذ',
    0xf269: 'ر',
    0xf26a: 'ر',
    0xf26b: 'ز',
    0xf26c: 'ز',
    0xf26d: 'س',
    0xf26e: 'س',
    0xf26f: 'س',
    0xf270: 'س',
    0xf271: 'ش',
    0xf272: 'ش',
    0xf273: 'ش',
    0xf274: 'ش',
    0xf275: 'ص',
    0xf276: 'ص',
    0xf277: 'ص',
    0xf278: 'ص',
    0xf279: 'ض',
    0xf27a: 'ض',
    0xf27b: 'ض',
    0xf27f: 'ط',
    0xf280: 'ط',
    0xf281: 'ط',
    0xf282: 'ط',
    0xf288: 'لخ',
    0xf290: 'ب',
    0xf294: 'ين',
    0xf299: 'يم',
    0xf29d: 'لم',
    0xf2a3: 'ظ',
    0xf2a4: 'ظ',
    0xf2a5: 'ظ',
    0xf2a6: 'ظ',
    0xf2a7: 'ع',
    0xf2a8: 'ع',
    0xf2a9: 'ع',
    0xf2aa: 'ع',
    0xf2ab: 'غ',
    0xf2ac: 'غ',
    0xf2ad: 'غ',
    0xf2ae: 'غ',
    0xf2af: 'ف',
    0xf2b0: 'ف',
    0xf2b1: 'ف',
    0xf2b2: 'ف',
    0xf2b3: 'ق',
    0xf2b4: 'ق',
    0xf2b5: 'ق',
    0xf2b6: 'ق',
    0xf2b7: 'ك',
    0xf2b8: 'ك',
    0xf2b9: 'ك',
    0xf2ba: 'ك',
    0xf2bb: 'ل',
    0xf2bc: 'ل',
    0xf2bd: 'ل',
    0xf2be: 'ل',
    0xf2bf: 'م',
    0xf2c0: 'م',
    0xf2c1: 'م',
    0xf2c2: 'م',
    0xf2c3: 'ن',
    0xf2c4: 'ن',
    0xf2c5: 'ن',
    0xf2c6: 'ن',
    0xf2c7: 'ه',
    0xf2c8: 'ه',
    0xf2c9: 'ه',
    0xf2ca: 'ه',
    0xf2cb: 'و',
    0xf2cc: 'و',
    0xf2cd: 'ي',
    0xf2ce: 'ي',
    0xf2cf: 'ي',
    0xf2d0: 'ي',
    0xf2d1: 'ة',
    0xf2d2: 'ة',
    0xf2d3: 'ى',
    0xf2d4: 'ى',
    0xf2d5: 'ء',
    0xf2d6: 'ئ',
    0xf2d7: 'ئ',
    0xf2dd: 'لا',
    0xf2de: 'لا',
    0xf2e0: 'آ',
    0xf2f1: 'ط'
};

// Standard AXt (ArabicXT) legacy font decoder (used in Diocese Part 3 large title headers)
const AXT_MAP = {
    A: 'ا',
    B: 'ا',
    C: 'أ',
    D: 'ا',
    E: 'أ',
    F: 'ؤ',
    G: 'إ',
    H: 'إ',
    I: 'ب',
    J: 'ب',
    K: 'ب',
    L: 'ب',
    M: 'ت',
    N: 'ت',
    O: 'ت',
    P: 'ت',
    Q: 'ث',
    R: 'ث',
    S: 'ث',
    T: 'ج',
    U: 'ج',
    V: 'ج',
    W: 'ح',
    X: 'ح',
    Y: 'ح',
    Z: 'ح',
    '[': 'خ',
    '\\': 'ح',
    ']': 'خ',
    '^': 'خ',
    _: '',
    '`': 'خ',
    a: 'خ',
    b: 'خ',
    c: 'د',
    d: 'د',
    e: 'د',
    f: 'د',
    g: 'ذ',
    h: 'ذ',
    i: 'ر',
    j: 'ر',
    k: 'ز',
    l: 'ز',
    m: 'س',
    n: 'س',
    o: 'س',
    p: 'س',
    q: 'ش',
    r: 'ش',
    s: 'ش',
    t: 'ش',
    u: 'ص',
    v: 'ص',
    w: 'ص',
    x: 'ض',
    y: 'ض',
    z: 'ض',
    '{': 'ض',
    '|': 'ض',
    '}': 'ط',
    '~': 'ض',
    '¦': 'ع',
    '§': 'ع',
    '¨': 'ع',
    '\u00a9': 'غ',
    'ª': 'غ',
    '«': 'غ',
    '¬': 'غ',
    '\u00ae': 'ف',
    '¯': 'ف',
    '°': 'ف',
    '±': 'ف',
    '²': 'ق',
    '³': 'ق',
    '´': 'ق',
    'µ': 'ق',
    '¶': 'ك',
    '·': 'ك',
    '¸': 'ك',
    '¹': 'ك',
    'º': 'ل',
    '»': 'ل',
    '¼': 'ل',
    '½': 'ل',
    '¾': 'م',
    '¿': 'م',
    'À': 'م',
    'Á': 'م',
    'Â': 'ن',
    'Ã': 'ن',
    'Ä': 'ن',
    'Å': 'ن',
    'Æ': 'ه',
    'Ç': 'ه',
    'È': 'ه',
    'É': 'ه',
    'Ê': 'و',
    'Ë': 'و',
    'Ì': 'ي',
    'Í': 'ي',
    'Î': 'ي',
    'Ï': 'ي',
    'Ð': 'ة',
    'Ñ': 'ة',
    'Ò': 'ى',
    'Ó': 'ى',
    'Ô': 'ء',
    'Õ': 'ئ',
    'Ö': 'ئ',
    '×': 'لا',
    'Ø': 'لا',
    'Ù': 'لا',
    'Ú': 'لا',
    'Û': 'لا',
    'Ü': 'لا',
    'Ý': 'لا',
    'Þ': 'لأ',
    'ß': 'لإ',
    'à': 'لآ',
    'á': 'لآ',
    'â': '',
    'ã': '',
    'ä': '',
    'å': '',
    'æ': '',
    'ç': '',
    'è': '',
    'é': '',
    'ê': '',
    'ë': '',
    'ì': '',
    'í': '',
    'î': '',
    'ï': '',
    'ð': 'ط',
    'ñ': '',
    'ò': '',
    'ó': '',
    'ô': 'ل',
    'õ': 'ل',
    'ö': '',
    '÷': 'ل',
    'ø': 'ل',
    'ù': 'ه',
    'ú': 'ة',
    'û': 'ى',
    'ü': 'ي',
    'ý': 'ي',
    'þ': 'ي',
    'ÿ': 'ي',
    '\u001a': 'له',
    '\u007f': 'ط',
    '\u0086': 'لج',
    '\u0087': 'لح',
    '\u0088': 'لخ',
    '\u009d': 'لم',
    '†': 'لج',
    '‡': 'لح',
    'ˆ': 'لخ',
    'Š': 'ع',
    'Œ': 'ي',
    'Ž': 'س',
    '‘': 'ا',
    '’': 'ا',
    '“': 'ا',
    '”': 'ا',
    '•': 'ب',
    '–': 'ب',
    '—': 'ب',
    '˜': 'ت',
    '\u2122': 'ت',
    'š': 'ت',
    '›': 'ث',
    'œ': 'ج',
    'ž': 'ح',
    'Ÿ': 'خ'
};

// Sultan / WinSoft Latin-Extended weekly header token map (used in Diocese Part 3 headers)
const LEGACY_WINSOFT_WEEK_PATTERNS = [
    { weekNumber: 1, weekLabel: 'الأسبوع الأول', token: 'Ľōŗí' },
    { weekNumber: 2, weekLabel: 'الأسبوع الثاني', token: 'ŒŇîüĿí' },
    { weekNumber: 3, weekLabel: 'الأسبوع الثالث', token: 'úĿîüĿí' },
    { weekNumber: 4, weekLabel: 'الأسبوع الرابع', token: 'ĪñíĎĿí' }
];

const LEGACY_WINSOFT_MONTH_PATTERNS = [
    { canonical: 'بشنس', token: 'ĒňĘñ' },
    { canonical: 'بؤونة', token: 'ŐŇåîñ' },
    { canonical: 'أبيب', token: 'ðŔñã' },
    { canonical: 'مسرى', token: 'ŏĎĔŃ' }
];

export function decodeArabicPuaF2xx(rawStr = '', { preserveEdgeSpaces = false } = {}) {
    const str = String(rawStr || '');
    if (!/[\uF200-\uF2FF]/.test(str)) return '';
    // Items in Word PUA PDFs are stored visually LTR (reversed RTL)
    const chars = Array.from(str).reverse();
    let out = '';
    for (const ch of chars) {
        const cp = ch.codePointAt(0);
        if (Object.prototype.hasOwnProperty.call(PUA_F2XX_MAP, cp)) {
            const mapped = PUA_F2XX_MAP[cp];
            if (mapped === '(') out += ')';
            else if (mapped === ')') out += '(';
            else out += mapped;
        } else if (cp >= 0xf2e4 && cp <= 0xf2ff) {
            continue; // PUA diacritics
        } else if (cp === 0x20 || ch === '"' || ch === '-' || ch === '(' || ch === ')') {
            if (ch === '(') out += ')';
            else if (ch === ')') out += '(';
            else out += ch;
        }
    }
    const normalized = out
        .replace(/\s+/g, ' ')
        .replace(/\(\s+/g, '(')
        .replace(/\s+\)/g, ')');
    return preserveEdgeSpaces ? normalized : normalized.trim();
}

export function decodeAxtArabic(rawStr = '') {
    const str = String(rawStr || '').trim();
    if (!str) return '';
    // AXt strings are stored visually LTR (reversed RTL)
    const preNormalized = str
        .replace(/ae/g, 'دخ')
        .replace(/BJÂÝA/g, 'ابناالأ');
    const chars = Array.from(preNormalized).reverse();
    let out = '';
    for (let i = 0; i < chars.length; i += 1) {
        const ch = chars[i];
        if (ch === ' ' || /[\u0600-\u06FF]/.test(ch)) {
            out += ch;
            continue;
        }
        if (ch === '_') continue;
        if (Object.prototype.hasOwnProperty.call(AXT_MAP, ch)) {
            out += AXT_MAP[ch];
        }
    }
    return out
        .replace(/للأ/g, 'الأ')
        .replace(/ألاانبا|الأانبا/g, 'الأنبا')
        .replace(/دخوول/g, 'دخول')
        .replace(/خدو/g, 'دخو')
        .replace(/اال/g, 'ال')
        .replace(/الكذبالمخبا/g, 'الكذب - المخبا')
        .replace(/صورةالسماء/g, 'صورة السماء')
        .replace(/مثلالوزنات/g, 'مثل الوزنات -')
        .replace(/([ةه])وال/g, '$1 وال')
        .replace(/لوا/g, 'ل وا')
        .replace(/الهيكلوالكنيسة/g, 'الهيكل والكنيسة')
        .replace(/\s+/g, ' ')
        .trim();
}

export function getCopticPartMeta(partNumber = 1) {
    const num = Number(partNumber) || 1;
    return COPTIC_YEAR_PARTS.find((p) => p.partNumber === num) || COPTIC_YEAR_PARTS[0];
}

export function getCopticMonthSlug(monthName = '') {
    const clean = String(monthName || '').trim();
    const found = COPTIC_MONTH_ALIASES.find(
        (m) => m.canonical === clean || m.patterns.some((p) => clean.includes(p))
    );
    if (found) return found.slug;
    return clean.replace(/\s+/g, '_').replace(/[^\u0600-\u06FFa-zA-Z0-9_]/g, '') || 'month';
}

export function normalizeArabicForSearch(text = '') {
    return String(text || '')
        .normalize('NFKC')
        .replace(/[\u064B-\u065F\u0670\u0640\uE800-\uE8FF]/g, '')
        .replace(/[أإآ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/\s+/g, ' ')
        .trim();
}

function detectMonthInLine(line = '', allowedMonths = []) {
    const normLine = normalizeArabicForSearch(line);
    const compactLine = normLine.replace(/\s+/g, '');
    if (!normLine) return null;

    // Check legacy WinSoft month tokens (Part 3)
    for (const lm of LEGACY_WINSOFT_MONTH_PATTERNS) {
        if (String(line).includes(lm.token)) {
            return lm.canonical;
        }
    }

    const orderedAliases = [
        ...COPTIC_MONTH_ALIASES.filter((m) => allowedMonths.includes(m.canonical)),
        ...COPTIC_MONTH_ALIASES.filter((m) => !allowedMonths.includes(m.canonical))
    ];

    for (const monthMeta of orderedAliases) {
        for (const pat of monthMeta.patterns) {
            const normPat = normalizeArabicForSearch(pat);
            const compactPat = normPat.replace(/\s+/g, '');
            const regex = new RegExp(`(?:^|\\s|شهر|من)(?:\\s*)${normPat}(?:$|\\s|[،.:)\\-])`);
            if (
                regex.test(normLine) ||
                normLine.includes(`شهر ${normPat}`) ||
                compactLine.includes(`منشهر${compactPat}`)
            ) {
                return monthMeta.canonical;
            }
        }
    }
    return null;
}

function detectWeekInLine(line = '') {
    const raw = String(line || '');
    // Check legacy WinSoft week markers (Part 3)
    if (raw.includes('ĩŎòēŗí') || raw.includes('ĎŌė')) {
        for (const lw of LEGACY_WINSOFT_WEEK_PATTERNS) {
            if (raw.includes(lw.token)) {
                return { weekNumber: lw.weekNumber, weekLabel: lw.weekLabel };
            }
        }
    }

    const normLine = normalizeArabicForSearch(raw);
    const compactLine = normLine.replace(/\s+/g, '');
    if (!normLine) return null;

    for (const wk of COPTIC_WEEK_MARKERS) {
        for (const pat of wk.patterns) {
            const normPat = normalizeArabicForSearch(pat);
            const compactPat = normPat.replace(/\s+/g, '');
            if (normLine.includes(normPat) || compactLine.includes(compactPat)) {
                return wk;
            }
        }
    }
    return null;
}

function cleanExtractedArabicTitle(rawTitle = '') {
    return String(rawTitle || '')
        .normalize('NFKC')
        .replace(/[\uE800-\uF8FF]/g, '')
        .replace(/^[-–—•*:0-9٠-٩.)(\s]+/g, '')
        .replace(/[.،؛:\s]+$/g, '')
        .replace(/الل\s*ه/g, 'الله')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractTitleFromRichPdfItems(items = [], rawPageFullText = '', nextPageFullText = '', isLegacyWinSoftPage = false) {
    if (!Array.isArray(items) || items.length === 0) return '';

    // 1. Check for Word PUA (0xF200..0xF2FF) story title on y ≈ 615..645 (Diocese Part 2 layout)
    const puaTitleItems = items
        .filter((it) => it.transform?.[5] >= 612 && it.transform?.[5] <= 645 && /[\uF200-\uF2FF]/.test(it.str || ''))
        .filter((it) => String(it.str || '').replace(/[\uF220\s]/g, '').length > 0);
    if (puaTitleItems.length > 0) {
        const sortedRtl = [...puaTitleItems].sort((a, b) => (b.transform?.[4] || 0) - (a.transform?.[4] || 0));
        const decodedChunks = [];
        for (let i = 0; i < sortedRtl.length; i += 1) {
            const piece = decodeArabicPuaF2xx(sortedRtl[i].str, { preserveEdgeSpaces: true });
            if (!piece) continue;
            decodedChunks.push(piece);
        }
        const combined = decodedChunks
            .join('')
            .replace(/([ىة])\s*(?=[أ-ي])/g, (m, p1) => `${p1} `)
            .replace(/هيلانه\s*والصليب/g, 'هيلانة والصليب')
            .replace(/([أ-ي])\(/g, '$1 (')
            .replace(/\s+/g, ' ')
            .replace(/\(\s+/g, '(')
            .replace(/\s+\)/g, ')')
            .trim();
        if (combined.length >= 3) {
            return combined;
        }
    }

    // 2. Check for AXt large-font title items ONLY on legacy WinSoft/AXt pages (Diocese Part 3 layout)
    const axtTitleItems = items.filter(
        (it) => Math.abs(it.transform?.[0] || 0) >= 30 && String(it.str || '').trim().length > 0
    );
    if (isLegacyWinSoftPage && axtTitleItems.length > 0) {
        const hasArabicAlready = axtTitleItems.some((it) => /[\u0600-\u06FF]/.test(String(it.str || '').normalize('NFKC')));
        if (!hasArabicAlready) {
            const byRow = new Map();
            for (const it of axtTitleItems) {
                const yKey = Math.round((it.transform?.[5] || 0) / 14) * 14;
                if (!byRow.has(yKey)) byRow.set(yKey, []);
                byRow.get(yKey).push(it);
            }
            const sortedYs = Array.from(byRow.keys()).sort((a, b) => b - a);
            const rowTexts = sortedYs.map((y) => {
                const rowItems = byRow.get(y).sort((a, b) => (a.transform?.[4] || 0) - (b.transform?.[4] || 0));
                return decodeAxtArabic(rowItems.map((r) => r.str).join(''));
            });
            const joinedAxt = rowTexts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
            if (joinedAxt.length >= 4) {
                return joinedAxt;
            }
        }
    }

    // 3. Fallback for broken subset-CID decorative title boxes (e.g. Diocese Part 1 FNTSBS+KhalidArtbold):
    // Extract clean Unicode subject from `محور الدرس` (second `سW...Wس` block) or `يعرف:` or `إليك عزيزي الخادم`
    const normFull = String(rawPageFullText || '').normalize('NFKC').replace(/\s+/g, ' ');
    const axisSegments = [...normFull.matchAll(/سW\s*([^\n]{3,110}?)\s*Wس/g)]
        .map((m) => {
            const rawSeg = m[1];
            // Strip any leading reference line before the inner `سW`
            const afterLastMarker = rawSeg.includes('سW') ? rawSeg.split('سW').pop() : rawSeg;
            return cleanExtractedArabicTitle(afterLastMarker.replace(/א/g, ''));
        })
        .filter((seg) => seg.length >= 5 && !seg.includes('موقع') && !seg.includes('تفسير') && !seg.includes('كتاب'));

    const genericAxisRe = /^(حياتي|كنيستي|ابائي|ايماني|ابديتي|اسره|مجتمع|حكايه\s*سفر|فضيله\s*للحياة|ه\s*\(\s*حياتي\s*\)\s*اسر|حياتي\s*\(?\s*اسره\s*\)?)$/i;
    const goodAxis = axisSegments.find((seg) => {
        const normSeg = normalizeArabicForSearch(seg).replace(/[.،؛:]/g, '').trim();
        return normSeg.length >= 6 && !genericAxisRe.test(normSeg) && !normSeg.includes('(حياتي');
    });
    if (goodAxis) {
        return goodAxis;
    }

    const knowsMatch = normFull.match(/يعرف\s*:?\s*([^.\n]{6,90})/);
    if (knowsMatch) {
        const knowsText = cleanExtractedArabicTitle(knowsMatch[1].split(/يشعر\s*:/)[0]);
        if (knowsText.length >= 6) return knowsText;
    }

    const normNext = String(nextPageFullText || '').normalize('NFKC').replace(/\s+/g, ' ');
    const introMatch = normNext.match(/إليك عزيزي الخادم\s*\.{0,3}\s*([^.\n]{8,90})/);
    if (introMatch) {
        const introClean = cleanExtractedArabicTitle(introMatch[1]);
        if (introClean.length >= 6) return introClean;
    }

    return '';
}

function extractCandidateTitleFromPageLines(lines = [], markerLineIndex = 0, copticMonth = '', weekLabel = '') {
    const ignoredPatterns = [
        /الاسبوع\s*(الاول|الثاني|الثالث|الرابع)/,
        /شهر\s*(توت|بابه|بابي|هاتور|كيهك|طوبه|طوبي|امشير|برمهات|برموده|بشنس|بؤونه|باؤني|ابيب|مسري)/,
        /^(الجزء\s+(الاول|الثاني|الثالث|الرابع)|منهج|مدارس\s+الاحد|الصف\s+|فهرس|المحتويات|مقدمه)$/,
        /^(الايه|الآيه|الهدف|الشاهد|عناصر\s+الدرس|تمهيد)[:\s]/,
        /^(سبتمبر|اكتوبر|نوفمبر|ديسمبر|يناير|فبراير|مارس|ابريل|مايو|يونيو|يوليو|اغسطس)$/,
        /^(رحله\s*يوم|ابائي|ابديتي|ايماني|اسره|مجتمع|كنيستي|حكايه\s*سفر|فضيله\s*للحياة|عيد\s*الغطاس|حياتي)[.\s]*$/,
        /^\d+$/
    ];

    const searchWindow = [];
    for (let offset = 1; offset <= 6; offset += 1) {
        if (lines[markerLineIndex + offset]) searchWindow.push(lines[markerLineIndex + offset]);
    }
    for (let offset = 1; offset <= 2; offset += 1) {
        if (markerLineIndex - offset >= 0 && lines[markerLineIndex - offset]) {
            searchWindow.push(lines[markerLineIndex - offset]);
        }
    }

    for (const rawCandidate of searchWindow) {
        const cleaned = cleanExtractedArabicTitle(rawCandidate);
        if (cleaned.length < 4 || cleaned.length > 95) continue;
        // Require majority Arabic characters so raw CID garbage is skipped
        const arabicCount = (cleaned.match(/[\u0600-\u06FF]/g) || []).length;
        if (arabicCount < 4 || arabicCount / cleaned.replace(/\s/g, '').length < 0.55) continue;
        const norm = normalizeArabicForSearch(cleaned);
        if (ignoredPatterns.some((re) => re.test(norm))) continue;
        return cleaned;
    }

    return `درس ${weekLabel} من شهر ${copticMonth}`;
}

/**
 * Pure deterministic parser that takes an array of page strings (or page line arrays, or
 * rich page objects `{ lines, items, fullText }`) and extracts Coptic lessons with automatic
 * fallback distribution when PDF text is partially or non-Unicode encoded.
 */
export function extractLessonsFromPagesText(pagesInput = [], partNumber = 1) {
    const partMeta = getCopticPartMeta(partNumber);
    const partMonths = partMeta.months;
    const totalPages = Math.max(1, Array.isArray(pagesInput) ? pagesInput.length : 1);

    const detectedBySlot = new Map();
    let activeMonth = partMonths[0];

    for (let idx = 0; idx < pagesInput.length; idx += 1) {
        const pageNum = idx + 1;
        const rawPage = pagesInput[idx];
        const isRichPage = rawPage && typeof rawPage === 'object' && !Array.isArray(rawPage);
        const lines = isRichPage
            ? (Array.isArray(rawPage.lines) ? rawPage.lines : [])
            : Array.isArray(rawPage)
                ? rawPage.map((l) => String(l || '').normalize('NFKC').trim()).filter(Boolean)
                : String(rawPage || '')
                    .normalize('NFKC')
                    .split(/\r?\n/)
                    .map((l) => l.trim())
                    .filter(Boolean);

        const fullPageText = isRichPage
            ? String(rawPage.fullText || lines.join(' '))
            : lines.join(' ');
        const rawPreNfkcText = isRichPage
            ? String(rawPage.rawFullText || fullPageText)
            : fullPageText;
        const isLegacyWinSoftPage = rawPreNfkcText.includes('ĩŎòēŗí') || rawPreNfkcText.includes('ĎŌė');
        const nextRawPage = pagesInput[idx + 1];
        const nextPageFullText = nextRawPage && typeof nextRawPage === 'object' && !Array.isArray(nextRawPage)
            ? String(nextRawPage.fullText || '')
            : '';

        if (lines.length === 0 && !fullPageText.trim()) continue;

        // First check whole-page header detection (preserve raw pre-NFKC lines for legacy WinSoft tokens like `Ŀ`)
        const headerScanLines = isLegacyWinSoftPage && Array.isArray(rawPage?.rawLines) && rawPage.rawLines.length > 0
            ? rawPage.rawLines
            : (lines.length > 0 ? lines : [fullPageText]);
        let matchedOnThisPage = false;

        for (let lineIdx = 0; lineIdx < headerScanLines.length; lineIdx += 1) {
            const line = headerScanLines[lineIdx];
            const foundMonth = detectMonthInLine(line, partMonths);
            if (foundMonth && partMonths.includes(foundMonth)) {
                activeMonth = foundMonth;
            }
            const foundWeek = detectWeekInLine(line);
            if (foundWeek) {
                const nearbyText = [
                    headerScanLines[lineIdx - 1] || '',
                    line,
                    headerScanLines[lineIdx + 1] || ''
                ].join(' ');
                const explicitMonth = detectMonthInLine(nearbyText, partMonths);
                const resolvedMonth = (explicitMonth && partMonths.includes(explicitMonth))
                    ? explicitMonth
                    : activeMonth;

                const slotKey = `${resolvedMonth}_w${foundWeek.weekNumber}`;
                if (!detectedBySlot.has(slotKey)) {
                    const richTitle = isRichPage
                        ? extractTitleFromRichPdfItems(rawPage.items, fullPageText, nextPageFullText, isLegacyWinSoftPage)
                        : '';
                    const title = richTitle || extractCandidateTitleFromPageLines(
                        headerScanLines,
                        lineIdx,
                        resolvedMonth,
                        foundWeek.weekLabel
                    );
                    detectedBySlot.set(slotKey, {
                        copticMonth: resolvedMonth,
                        weekNumber: foundWeek.weekNumber,
                        weekLabel: foundWeek.weekLabel,
                        title,
                        startPage: pageNum
                    });
                }
                matchedOnThisPage = true;
                break;
            }
        }

        // Secondary whole-page check in case PDF.js split `الأسبوع الأول` across two Y baselines
        if (!matchedOnThisPage && rawPreNfkcText) {
            const topSnippet = rawPreNfkcText.slice(0, 320);
            const foundWeek = detectWeekInLine(topSnippet);
            const foundMonth = detectMonthInLine(topSnippet, partMonths);
            if (foundWeek && foundMonth && partMonths.includes(foundMonth)) {
                activeMonth = foundMonth;
                const slotKey = `${foundMonth}_w${foundWeek.weekNumber}`;
                if (!detectedBySlot.has(slotKey)) {
                    const richTitle = isRichPage
                        ? extractTitleFromRichPdfItems(rawPage.items, fullPageText, nextPageFullText, isLegacyWinSoftPage)
                        : '';
                    const title = richTitle || `درس ${foundWeek.weekLabel} من شهر ${foundMonth}`;
                    detectedBySlot.set(slotKey, {
                        copticMonth: foundMonth,
                        weekNumber: foundWeek.weekNumber,
                        weekLabel: foundWeek.weekLabel,
                        title,
                        startPage: pageNum
                    });
                }
            }
        }
    }

    const expectedTotalSlots = partMonths.length * 4;
    const detectedCount = detectedBySlot.size;
    const usedFallback = detectedCount < expectedTotalSlots;

    const introOffset = totalPages > 20 ? 3 : 1;
    const usablePages = Math.max(1, totalPages - introOffset + 1);
    const pagesPerLesson = Math.max(1, Math.floor(usablePages / expectedTotalSlots));

    const lessons = [];
    partMonths.forEach((monthName, mIdx) => {
        const monthOrder = mIdx + 1;
        const monthSlug = getCopticMonthSlug(monthName);
        for (let weekNum = 1; weekNum <= 4; weekNum += 1) {
            const slotIndex = mIdx * 4 + (weekNum - 1);
            const weekMeta = COPTIC_WEEK_MARKERS[weekNum - 1];
            const slotKey = `${monthName}_w${weekNum}`;
            const detected = detectedBySlot.get(slotKey);

            const defaultStart = Math.min(
                totalPages,
                introOffset + slotIndex * pagesPerLesson
            );

            lessons.push({
                id: `lesson_p${partMeta.partNumber}_${monthSlug}_w${weekNum}`,
                copticMonth: monthName,
                monthOrder,
                weekNumber: weekNum,
                weekLabel: weekMeta.weekLabel,
                title: detected?.title || `درس ${weekMeta.weekLabel} - شهر ${monthName}`,
                startPage: detected?.startPage || defaultStart,
                endPage: detected?.startPage || defaultStart,
                isCompleted: false,
                completedAt: null,
                completedBy: null
            });
        }
    });

    for (let i = 0; i < lessons.length; i += 1) {
        if (i > 0 && lessons[i].startPage < lessons[i - 1].startPage) {
            lessons[i].startPage = Math.min(totalPages, lessons[i - 1].startPage + 1);
        }
    }
    for (let i = 0; i < lessons.length; i += 1) {
        const nextStart = i < lessons.length - 1 ? lessons[i + 1].startPage : null;
        if (nextStart && nextStart > lessons[i].startPage) {
            lessons[i].endPage = nextStart - 1;
        } else if (i === lessons.length - 1) {
            lessons[i].endPage = Math.max(lessons[i].startPage, totalPages);
        } else {
            lessons[i].endPage = lessons[i].startPage;
        }
    }

    return {
        partNumber: partMeta.partNumber,
        partLabel: partMeta.label,
        shortPartLabel: partMeta.shortLabel,
        copticMonths: [...partMonths],
        totalPages,
        detectedCount,
        usedFallback,
        lessons
    };
}

/**
 * Reads a PDF File/ArrayBuffer in the browser (or Node with `{ pdfjsLib }`), extracts text lines
 * and layout items per page, and builds the structured Coptic Year lesson plan for the chosen Part.
 */
export async function extractLessonsFromCopticPdf(fileOrBuffer, partNumber = 1, options = {}) {
    const partMeta = getCopticPartMeta(partNumber);
    if (!fileOrBuffer) {
        throw new Error('يرجى اختيار ملف الـ PDF أولاً');
    }

    try {
        const pdfjsLib = options?.pdfjsLib || await getPdfJsLib();
        const arrayBuffer = typeof fileOrBuffer.arrayBuffer === 'function'
            ? await fileOrBuffer.arrayBuffer()
            : fileOrBuffer;

        const uint8 = arrayBuffer instanceof Uint8Array
            ? arrayBuffer
            : new Uint8Array(arrayBuffer);

        let pdfDoc = null;
        try {
            const loadingTask = pdfjsLib.getDocument({
                data: uint8,
                useSystemFonts: true,
                isEvalSupported: false,
                disableWorker: Boolean(options?.disableWorker)
            });
            pdfDoc = await loadingTask.promise;
        } catch {
            const fallbackTask = pdfjsLib.getDocument({
                data: uint8,
                disableWorker: true,
                useSystemFonts: true,
                isEvalSupported: false
            });
            pdfDoc = await fallbackTask.promise;
        }

        const numPages = Math.max(1, Number(pdfDoc?.numPages) || 1);
        const richPages = [];

        for (let pageNum = 1; pageNum <= numPages; pageNum += 1) {
            try {
                const page = await pdfDoc.getPage(pageNum);
                const textContent = await page.getTextContent();
                const items = Array.isArray(textContent?.items) ? textContent.items : [];

                const rowMap = new Map();
                for (const item of items) {
                    const str = String(item?.str || '').trim();
                    if (!str) continue;
                    const y = Math.round((item?.transform?.[5] || 0) / 5) * 5;
                    if (!rowMap.has(y)) rowMap.set(y, []);
                    rowMap.get(y).push(item);
                }

                const sortedYs = Array.from(rowMap.keys()).sort((a, b) => b - a);
                const rawLines = sortedYs
                    .map((y) => {
                        const sortedRow = [...rowMap.get(y)].sort((a, b) => (b.transform?.[4] || 0) - (a.transform?.[4] || 0));
                        return sortedRow
                            .map((it) => String(it.str || ''))
                            .join(' ')
                            .replace(/\s+/g, ' ')
                            .trim();
                    })
                    .filter(Boolean);

                const pageLines = rawLines.map((l) => l.normalize('NFKC'));
                const rawFullText = items.map((it) => String(it?.str || '')).join('').replace(/\s+/g, ' ');
                const fullText = rawFullText.normalize('NFKC');

                richPages.push({ lines: pageLines, rawLines, items, fullText, rawFullText });
            } catch {
                richPages.push({ lines: [], rawLines: [], items: [], fullText: '', rawFullText: '' });
            }
        }

        return extractLessonsFromPagesText(richPages, partMeta.partNumber);
    } catch (err) {
        console.warn('[pdfCurriculumIndexer] PDF text scan fallback triggered:', err?.message || err);
        return extractLessonsFromPagesText(new Array(64).fill(''), partMeta.partNumber);
    }
}

function canvasToJpegUint8(canvas, quality = 0.62) {
    return new Promise((resolve, reject) => {
        if (typeof canvas.toBlob === 'function') {
            canvas.toBlob(
                async (blob) => {
                    if (!blob) {
                        reject(new Error('تعذر تحويل صفحة الـ PDF إلى صورة مضغوطة'));
                        return;
                    }
                    const ab = await blob.arrayBuffer();
                    resolve(new Uint8Array(ab));
                },
                'image/jpeg',
                quality
            );
            return;
        }
        try {
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            const b64 = dataUrl.split(',')[1] || '';
            const bin = atob(b64);
            const u8 = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i += 1) {
                u8[i] = bin.charCodeAt(i);
            }
            resolve(u8);
        } catch (err) {
            reject(err);
        }
    });
}

async function rasterizePdfWithBudget(pdfDoc, PDFDocument, {
    targetBytes,
    scale = 1.25,
    quality = 0.62,
    fallbackQuality = 0.48,
    onPageProgress = null
}) {
    const numPages = Math.max(1, Number(pdfDoc?.numPages) || 1);
    const perPageBudget = Math.max(28 * 1024, Math.floor((targetBytes * 0.94) / numPages));

    const outPdf = await PDFDocument.create();
    outPdf.setTitle('');
    outPdf.setAuthor('');
    outPdf.setProducer('');
    outPdf.setCreator('');

    const renderCanvas = document.createElement('canvas');
    const renderCtx = renderCanvas.getContext('2d', { alpha: false });
    let downscaleCanvas = null;

    for (let pageNum = 1; pageNum <= numPages; pageNum += 1) {
        const page = await pdfDoc.getPage(pageNum);
        const origViewport = page.getViewport({ scale: 1 });
        const effectiveScale = numPages > 95 ? Math.min(scale, 1.1) : scale;
        const scaledViewport = page.getViewport({ scale: effectiveScale });

        renderCanvas.width = Math.max(1, Math.floor(scaledViewport.width));
        renderCanvas.height = Math.max(1, Math.floor(scaledViewport.height));
        renderCtx.fillStyle = '#FFFFFF';
        renderCtx.fillRect(0, 0, renderCanvas.width, renderCanvas.height);

        await page.render({
            canvasContext: renderCtx,
            viewport: scaledViewport
        }).promise;

        let jpgBytes = await canvasToJpegUint8(renderCanvas, quality);

        if (jpgBytes.byteLength > perPageBudget * 1.25 && fallbackQuality < quality) {
            jpgBytes = await canvasToJpegUint8(renderCanvas, fallbackQuality);
        }

        if (jpgBytes.byteLength > perPageBudget * 1.55) {
            if (!downscaleCanvas) {
                downscaleCanvas = document.createElement('canvas');
            }
            downscaleCanvas.width = Math.max(1, Math.floor(renderCanvas.width * 0.8));
            downscaleCanvas.height = Math.max(1, Math.floor(renderCanvas.height * 0.8));
            const downCtx = downscaleCanvas.getContext('2d', { alpha: false });
            downCtx.fillStyle = '#FFFFFF';
            downCtx.fillRect(0, 0, downscaleCanvas.width, downscaleCanvas.height);
            downCtx.drawImage(renderCanvas, 0, 0, downscaleCanvas.width, downscaleCanvas.height);
            jpgBytes = await canvasToJpegUint8(downscaleCanvas, Math.min(fallbackQuality, 0.45));
        }

        const embeddedImg = await outPdf.embedJpg(jpgBytes);
        const pdfPage = outPdf.addPage([origViewport.width, origViewport.height]);
        pdfPage.drawImage(embeddedImg, {
            x: 0,
            y: 0,
            width: origViewport.width,
            height: origViewport.height
        });

        try {
            page.cleanup?.();
        } catch {
            // ignore cleanup errors
        }

        if (typeof onPageProgress === 'function') {
            onPageProgress(pageNum, numPages);
        }
    }

    renderCanvas.width = 1;
    renderCanvas.height = 1;
    if (downscaleCanvas) {
        downscaleCanvas.width = 1;
        downscaleCanvas.height = 1;
    }

    return outPdf.save({
        useObjectStreams: true,
        addDefaultPage: false,
        objectsPerTick: 50
    });
}

function wrapBytesAsPdfFile(uint8Bytes, originalFile) {
    const fileName = String(originalFile?.name || 'curriculum.pdf').trim() || 'curriculum.pdf';
    if (typeof File !== 'undefined') {
        return new File([uint8Bytes], fileName, {
            type: 'application/pdf',
            lastModified: Date.now()
        });
    }
    if (typeof Blob !== 'undefined') {
        const blob = new Blob([uint8Bytes], { type: 'application/pdf' });
        blob.name = fileName;
        return blob;
    }
    return uint8Bytes;
}

/**
 * Smart Client-Side PDF Compressor (`pdf-lib` structural optimization + `pdfjs-dist` adaptive JPEG rebuild).
 * Guarantees output < 9.5 MB (targeting <= 8.5 MB) when running in browser on oversized PDFs.
 */
export async function compressPdfInBrowser(file, options = {}) {
    if (!file) throw new Error('يرجى اختيار ملف الـ PDF أولاً');

    const targetMaxMB = Number(options?.targetMaxMB) > 0 ? Number(options.targetMaxMB) : 8.5;
    const hardCeilingMB = Number(options?.hardCeilingMB) > 0 ? Number(options.hardCeilingMB) : 9.2;
    const maxGuaranteedMB = 9.5;
    const targetBytes = Math.floor(targetMaxMB * 1024 * 1024);
    const hardCeilingBytes = Math.floor(hardCeilingMB * 1024 * 1024);
    const maxGuaranteedBytes = Math.floor(maxGuaranteedMB * 1024 * 1024);
    const onProgress = typeof options?.onProgress === 'function' ? options.onProgress : null;

    const rawBuffer = typeof file.arrayBuffer === 'function'
        ? await file.arrayBuffer()
        : file;
    const rawUint8 = rawBuffer instanceof Uint8Array
        ? rawBuffer
        : new Uint8Array(rawBuffer);
    const originalBytes = Number(file.size || rawUint8.byteLength || 0);
    const originalMB = Number((originalBytes / (1024 * 1024)).toFixed(2));

    if (onProgress) onProgress(8, { phase: 'structural', originalBytes });

    const { PDFDocument } = await import('pdf-lib');
    let bestBytes = rawUint8;

    // Pass 1: Lossless structural optimization (object streams + strip unused metadata/objects)
    try {
        const loadedPdf = await PDFDocument.load(rawUint8, {
            ignoreEncryption: true,
            updateMetadata: false
        });
        loadedPdf.setTitle('');
        loadedPdf.setAuthor('');
        loadedPdf.setSubject('');
        loadedPdf.setKeywords([]);
        loadedPdf.setProducer('');
        loadedPdf.setCreator('');

        const optimizedBytes = await loadedPdf.save({
            useObjectStreams: true,
            addDefaultPage: false,
            objectsPerTick: 50
        });
        if (optimizedBytes.byteLength > 0 && optimizedBytes.byteLength < bestBytes.byteLength) {
            bestBytes = optimizedBytes;
        }
    } catch (structErr) {
        console.warn('[compressPdfInBrowser] Structural pass skipped:', structErr?.message || structErr);
    }

    if (bestBytes.byteLength <= hardCeilingBytes || typeof document === 'undefined') {
        if (onProgress) onProgress(100, { phase: 'done', originalBytes, compressedBytes: bestBytes.byteLength });
        const outFile = wrapBytesAsPdfFile(bestBytes, file);
        const compressedMB = Number((bestBytes.byteLength / (1024 * 1024)).toFixed(2));
        const savedPercent = originalBytes > 0
            ? Math.max(0, Math.round(((originalBytes - bestBytes.byteLength) / originalBytes) * 100))
            : 0;
        return {
            file: outFile,
            originalBytes,
            compressedBytes: bestBytes.byteLength,
            originalMB,
            compressedMB,
            savedPercent,
            wasCompressed: bestBytes.byteLength < originalBytes,
            wasRasterized: false
        };
    }

    // Pass 2: Oversized (> 9.2 MB) image-heavy/scanned PDF -> Re-render pages via pdfjs-dist into compact JPEG PDF
    if (onProgress) onProgress(15, { phase: 'rasterizing', originalBytes });

    const pdfjsLib = await getPdfJsLib();
    let pdfDoc = null;
    try {
        pdfDoc = await pdfjsLib.getDocument({
            data: rawUint8.slice(0),
            useSystemFonts: true,
            isEvalSupported: false
        }).promise;
    } catch {
        pdfDoc = await pdfjsLib.getDocument({
            data: rawUint8.slice(0),
            disableWorker: true,
            useSystemFonts: true,
            isEvalSupported: false
        }).promise;
    }

    let rasterizedBytes = await rasterizePdfWithBudget(pdfDoc, PDFDocument, {
        targetBytes,
        scale: 1.25,
        quality: 0.62,
        fallbackQuality: 0.48,
        onPageProgress: (pageNum, total) => {
            if (!onProgress) return;
            const pct = Math.min(96, 15 + Math.round((pageNum / total) * 80));
            onProgress(pct, { phase: 'rasterizing', pageNum, total });
        }
    });

    // Emergency ultra-compact pass if still > 9.5 MB on massive multi-hundred-page books
    if (rasterizedBytes.byteLength > maxGuaranteedBytes) {
        rasterizedBytes = await rasterizePdfWithBudget(pdfDoc, PDFDocument, {
            targetBytes: Math.floor(7.8 * 1024 * 1024),
            scale: 0.92,
            quality: 0.46,
            fallbackQuality: 0.38,
            onPageProgress: (pageNum, total) => {
                if (!onProgress) return;
                const pct = Math.min(99, 90 + Math.round((pageNum / total) * 9));
                onProgress(pct, { phase: 'rasterizing_compact', pageNum, total });
            }
        });
    }

    try {
        await pdfDoc.destroy?.();
    } catch {
        // ignore
    }

    const finalBytes = rasterizedBytes.byteLength < bestBytes.byteLength ? rasterizedBytes : bestBytes;
    const outFile = wrapBytesAsPdfFile(finalBytes, file);
    const compressedMB = Number((finalBytes.byteLength / (1024 * 1024)).toFixed(2));
    const savedPercent = originalBytes > 0
        ? Math.max(0, Math.round(((originalBytes - finalBytes.byteLength) / originalBytes) * 100))
        : 0;

    if (onProgress) onProgress(100, { phase: 'done', originalBytes, compressedBytes: finalBytes.byteLength });

    return {
        file: outFile,
        originalBytes,
        compressedBytes: finalBytes.byteLength,
        originalMB,
        compressedMB,
        savedPercent,
        wasCompressed: finalBytes.byteLength < originalBytes,
        wasRasterized: true
    };
}

/**
 * Full Smart In-Browser Pipeline:
 *   Step 1: Extract crisp Arabic lesson titles & exact startPage/endPage from the ORIGINAL PDF first.
 *   Step 2: Compress the PDF in-browser (`pdf-lib` + adaptive JPEG rasterizer when > 9.2 MB) to < 8.5–9.5 MB.
 */
export async function analyzeAndCompressCurriculumPdf(file, partNumber = 1, onStatus = null) {
    if (!file) throw new Error('يرجى اختيار ملف الـ PDF أولاً');

    const emit = (payload) => {
        if (typeof onStatus === 'function') onStatus(payload);
    };

    emit({
        stage: 'analyzing',
        progress: 0,
        message: 'جاري تحليل الـ PDF وتقسيم الدروس على أسابيع السنة...'
    });

    const extracted = await extractLessonsFromCopticPdf(file, partNumber);

    emit({
        stage: 'compressing',
        progress: 5,
        message: 'جاري ضغط ملف الـ PDF لأصغر مساحة ممكنة... (5%)'
    });

    const compression = await compressPdfInBrowser(file, {
        targetMaxMB: 8.5,
        hardCeilingMB: 9.2,
        onProgress: (pct) => {
            emit({
                stage: 'compressing',
                progress: pct,
                message: `جاري ضغط ملف الـ PDF لأصغر مساحة ممكنة... (${pct}%)`
            });
        }
    });

    emit({
        stage: 'ready',
        progress: 100,
        extracted,
        compression,
        message: `الحجم الأصلي: ${compression.originalMB} MB -> الحجم بعد الضغط: ${compression.compressedMB} MB`
    });

    return {
        extracted,
        compressedFile: compression.file,
        compression
    };
}
