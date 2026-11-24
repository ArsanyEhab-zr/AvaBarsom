// src/utils/churchStructureSanitizer.js
// Permanent tenant-boundary guard purifying church services and authorized servants
// against legacy Kinonia or previous-church data leakage.

export const OFFICIAL_ST_BARSOUM_CLASS_KEYS = [
    // Real Production 20 Classes/Osras (9 Services)
    'تمهيدي',
    'KG1',
    'KG2',
    'أولى ابتدائي',
    'تانية ابتدائي',
    'تالتة ابتدائي',
    'رابعة ابتدائي',
    'خامسة ابتدائي',
    'سادسة ابتدائي',
    'أولى إعدادي',
    'تانية إعدادي',
    'تالتة إعدادي',
    'أولى ثانوي',
    'تانية ثانوي',
    'تالتة ثانوي',
    'جامعة',
    'إجتماع الخدام العام',
    'خدام مدارس الأحد',
    'إجتماع أمهات مدارس الأحد',
    'إجتماع الآباء',
    // Legacy aliases preserved for backward compatibility with existing tests
    'كي جي 1',
    'كي جي 2',
    'ثانية ابتدائي',
    'ثالثة ابتدائي',
    'إعدادي بنين',
    'إعدادي بنات',
    'ثانوي بنين',
    'ثانوي بنات',
    'خدمة جامعة',
    'اجتماع الخدام العام',
];

export const OFFICIAL_ST_BARSOUM_SERVANTS = [
    {
        id: 'srv_demo_priest',
        name: 'أبونا راعي الكنيسة (تجريبي)',
        role: 'كاهن',
        phone: '01000000001',
        syncKey: 'MASTER_ACCESS',
        assignedOsra: 'كل الكنيسة',
        osraName: 'كل الكنيسة',
        serviceName: 'كنيسة الأنبا برسوم العريان بطهنشا',
    },
    {
        id: 'srv_demo_amin',
        name: 'أ. أرساني - أمين عام الخدمة',
        role: 'أمين خدمة',
        phone: '01000000002',
        syncKey: 'MASTER_ACCESS',
        assignedOsra: 'كل الكنيسة',
        osraName: 'كل الكنيسة',
        serviceName: 'كنيسة الأنبا برسوم العريان بطهنشا',
    },
    {
        id: 'srv_demo_stage_ss',
        name: 'أ. بيشوي نبيل - أمين مرحلة مدارس الأحد',
        role: 'أمين مرحلة',
        phone: '01000000008',
        syncKey: 'STAGE_ADMIN',
        stageName: 'مجموعة مدارس الأحد',
        assignedStages: ['مجموعة مدارس الأحد'],
        assignedOsra: 'مجموعة مدارس الأحد',
        osraName: 'مجموعة مدارس الأحد',
        serviceName: 'مجموعة مدارس الأحد',
    },
    {
        id: 'srv_demo_ss_lead',
        name: 'أ. بيشوي نبيل - خدام مدارس الأحد',
        role: 'أمين أسرة',
        phone: '01000000003',
        syncKey: 'خدام مدارس الأحد',
        assignedOsra: 'خدام مدارس الأحد',
        osraName: 'خدام مدارس الأحد',
        serviceName: 'مجموعة مدارس الأحد',
    },
    {
        id: 'srv_demo_primary',
        name: 'تاسوني مريم - رابعة ابتدائي',
        role: 'خادم',
        phone: '01000000004',
        syncKey: 'رابعة ابتدائي',
        assignedOsra: 'رابعة ابتدائي',
        osraName: 'رابعة ابتدائي',
        serviceName: 'مجموعة مدارس الأحد',
    },
    {
        id: 'srv_demo_prep',
        name: 'أ. يوسف جرجس - إعدادي بنين',
        role: 'خادم',
        phone: '01000000005',
        syncKey: 'إعدادي بنين',
        assignedOsra: 'إعدادي بنين',
        osraName: 'إعدادي بنين',
        serviceName: 'خدمة إعدادي',
    },
    {
        id: 'srv_demo_sec',
        name: 'أ. مينا فؤاد - ثانوي بنين',
        role: 'خادم',
        phone: '01000000006',
        syncKey: 'ثانوي بنين',
        assignedOsra: 'ثانوي بنين',
        osraName: 'ثانوي بنين',
        serviceName: 'خدمة ثانوي',
    },
    {
        id: 'srv_demo_uni',
        name: 'د. جورج سمير - خدمة جامعة',
        role: 'خادم',
        phone: '01000000007',
        syncKey: 'خدمة جامعة',
        assignedOsra: 'خدمة الشباب والجامعة',
        osraName: 'خدمة الشباب والجامعة',
        serviceName: 'خدمة جامعة',
    },
];

export const LEGACY_KINONIA_CLASS_TOKENS = [
    'فصل الشهيد زكريا',
    'الشهيد زكريا',
    'فصل القديسة رفقة',
    'القديسة رفقة',
    'فصل الانبا كاراس',
    'الانبا كاراس',
    'فصل اناسيمون',
    'اناسيمون',
    'فصل الانبا باخوميوس',
    'الانبا باخوميوس',
    'فصل القديسة اربسيما',
    'القديسة اربسيما',
    'اربسيما',
    'فصل مارافرام السرياني',
    'مارافرام السرياني',
    'مارافرام',
    'فصل الام سارة',
    'الام سارة',
    'فصل الملاك غبريال',
    'الملاك غبريال',
    'فصل الملاك ميخائيل',
    'الملاك ميخائيل',
    'فصل الانبا شنودة',
    'الانبا شنودة',
    'فصل الانبا بيشوي',
    'الانبا بيشوي',
];

export const LEGACY_KINONIA_SERVANT_NAMES = [
    'bavly aziz',
    'متياس بسيط سمعان',
    'كرستيان فخري زكريا',
    'سيلفيا ايمن لويز',
    'مكاريوس سمير',
    'ابرام زكريا',
];

const LEGACY_BRAND_TOKENS = [
    'kinonia',
    'كينونيا',
    'كنيونيا',
    'stgeorge',
    'st george',
    'gamaza',
    'ghamaza',
    'مارجرجس',
    'غمازة',
    'غامازا',
    'khedmety',
    'خدمتي',
];

const ADMIN_SENTINELS = new Set(['MASTER_ACCESS', 'ADMIN_MODE', 'STAGE_ADMIN']);

export function normalizeArMatch(value = '') {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[\u064B-\u065F\u0670]/g, '')
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/\s+/g, ' ');
}

const NORMALIZED_LEGACY_CLASSES = LEGACY_KINONIA_CLASS_TOKENS.map(normalizeArMatch);
const NORMALIZED_LEGACY_SERVANTS = LEGACY_KINONIA_SERVANT_NAMES.map(normalizeArMatch);
const NORMALIZED_LEGACY_BRANDS = LEGACY_BRAND_TOKENS.map(normalizeArMatch);
const NORMALIZED_OFFICIAL_CLASSES = new Set(OFFICIAL_ST_BARSOUM_CLASS_KEYS.map(normalizeArMatch));

export function isLegacyKinoniaClass(classNameOrKey = '') {
    const norm = normalizeArMatch(classNameOrKey);
    if (!norm) return false;
    if (NORMALIZED_OFFICIAL_CLASSES.has(norm)) return false;

    if (NORMALIZED_LEGACY_CLASSES.some((token) => norm === token || norm.includes(token))) {
        return true;
    }
    if (NORMALIZED_LEGACY_BRANDS.some((token) => norm.includes(token))) {
        return true;
    }
    return false;
}

export function isLegacyKinoniaServant(servant, validServices = null, options = {}) {
    if (!servant || typeof servant !== 'object') return true;
    const allowDemoServants = Boolean(options?.allowDemoServants);

    if (!allowDemoServants) {
        const idStr = String(servant.id || '').trim();
        if (idStr.startsWith('srv_demo_') || servant.isDemo === true || String(servant.name || '').includes('(تجريبي)')) {
            return true;
        }
    }

    const nameNorm = normalizeArMatch(servant.name);
    if (nameNorm && NORMALIZED_LEGACY_SERVANTS.some((legacyName) => nameNorm.includes(legacyName))) {
        return true;
    }
    if (nameNorm === 'bavly') return true;

    const combinedMeta = normalizeArMatch([
        servant.name,
        servant.email,
        servant.serviceName,
        servant.assignedOsra,
        servant.osraName,
        servant.osraKey,
        servant.syncKey,
        servant.stageName,
    ].filter(Boolean).join(' '));

    if (NORMALIZED_LEGACY_BRANDS.some((token) => combinedMeta.includes(token))) {
        return true;
    }

    const candidateKeys = [
        servant.syncKey,
        servant.osraKey,
        servant.assignedOsra,
        servant.osraName,
        ...(Array.isArray(servant.allowedClasses) ? servant.allowedClasses : []),
        ...(Array.isArray(servant.assignedStages) ? servant.assignedStages : []),
    ].filter(Boolean);

    if (candidateKeys.some((k) => isLegacyKinoniaClass(k))) {
        return true;
    }

    // Extract valid class keys and stages from validServices when provided
    const hasExplicitServices = Array.isArray(validServices) && validServices.length > 0;
    const validClassKeys = new Set(NORMALIZED_OFFICIAL_CLASSES);
    const validStagesAndServices = new Set();

    if (hasExplicitServices) {
        for (const svc of validServices) {
            if (!svc) continue;
            if (svc.name) validStagesAndServices.add(normalizeArMatch(svc.name));
            if (svc.serviceGroup) validStagesAndServices.add(normalizeArMatch(svc.serviceGroup));
            for (const osra of (svc.osras || [])) {
                const k = normalizeArMatch(osra?.syncKey || osra?.name);
                if (k && !isLegacyKinoniaClass(k)) {
                    validClassKeys.add(k);
                }
                if (osra?.name) {
                    validClassKeys.add(normalizeArMatch(osra.name));
                }
                if (osra?.osraKey) {
                    validClassKeys.add(normalizeArMatch(osra.osraKey));
                }
                if (osra?.secretKey) {
                    validClassKeys.add(normalizeArMatch(osra.secretKey));
                }
                if (osra?.stageName) validStagesAndServices.add(normalizeArMatch(osra.stageName));
            }
        }
    }

    const rawSyncKey = String(servant.syncKey || servant.osraKey || '').trim();
    const roleStr = normalizeArMatch(servant.role);
    const isAdminOrLeaderRole =
        ADMIN_SENTINELS.has(rawSyncKey) ||
        roleStr.includes('كاهن') ||
        roleStr.includes('ادمن') ||
        roleStr.includes('admin') ||
        roleStr.includes('امين خدمه') ||
        roleStr.includes('امينه خدمه') ||
        roleStr.includes('امين عام') ||
        roleStr.includes('امين مرحله');

    // Class servant bound to a specific class that does not belong to this church
    if (hasExplicitServices && rawSyncKey && !ADMIN_SENTINELS.has(rawSyncKey)) {
        const normSync = normalizeArMatch(rawSyncKey);
        if (!validClassKeys.has(normSync)) {
            return true;
        }
    }

    // Legacy Kinonia non-admin servant with no valid St. Barsoum class assignment
    if (hasExplicitServices && !rawSyncKey && !isAdminOrLeaderRole && servant.assignedOsra) {
        const normOsra = normalizeArMatch(servant.assignedOsra);
        if (!validClassKeys.has(normOsra)) {
            return true;
        }
    }

    return false;
}

export function sanitizeChurchServices(servicesList, defaultServices = []) {
    if (!Array.isArray(servicesList)) {
        return Array.isArray(defaultServices) ? defaultServices : [];
    }
    if (servicesList.length === 0) {
        return Array.isArray(defaultServices) && defaultServices.length > 0 ? defaultServices : [];
    }

    const cleanedServices = [];
    for (const svc of servicesList) {
        if (!svc || typeof svc !== 'object') continue;
        const svcNameNorm = normalizeArMatch(svc.name);
        if (NORMALIZED_LEGACY_BRANDS.some((b) => svcNameNorm.includes(b))) {
            continue;
        }
        const rawOsras = Array.isArray(svc.osras) ? svc.osras : [];
        const cleanOsras = rawOsras.filter((osra) => {
            if (!osra) return false;
            return !isLegacyKinoniaClass(osra.syncKey) && !isLegacyKinoniaClass(osra.name);
        });
        // Skip a service if it originally only held Kinonia classes and now has 0 classes
        if (rawOsras.length > 0 && cleanOsras.length === 0) {
            continue;
        }
        cleanedServices.push({ ...svc, osras: cleanOsras });
    }

    if (cleanedServices.length === 0) {
        return Array.isArray(defaultServices) ? defaultServices : [];
    }

    return cleanedServices;
}

/**
 * Filters out legacy Kinonia and fake demo servants. In production mode (default),
 * returns an empty array `[]` when no real servants exist unless `fallbackToOfficial: true`
 * is explicitly passed (used only in legacy unit tests).
 */
export function sanitizeAuthorizedServants(servantsList, validServices = null, options = {}) {
    const shouldFallback = Boolean(options?.fallbackToOfficial === true || options?.fallbackToDefaults === true);
    const allowDemoServants = Boolean(options?.allowDemoServants === true);
    const list = Array.isArray(servantsList) ? servantsList : [];

    const seen = new Set();
    const cleaned = [];

    for (const servant of list) {
        if (isLegacyKinoniaServant(servant, validServices, { allowDemoServants })) {
            continue;
        }
        const dedupKey = String(
            servant.id || `${normalizeArMatch(servant.phone)}::${normalizeArMatch(servant.syncKey || servant.osraKey)}::${normalizeArMatch(servant.name)}`
        ).trim();
        if (dedupKey && seen.has(dedupKey)) continue;
        if (dedupKey) seen.add(dedupKey);
        cleaned.push(servant);
    }

    if (cleaned.length === 0 && shouldFallback) {
        return JSON.parse(JSON.stringify(OFFICIAL_ST_BARSOUM_SERVANTS));
    }

    return cleaned;
}
