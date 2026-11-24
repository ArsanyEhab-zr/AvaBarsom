/**
 * Single Source of Truth (SSOT) for Church Identity, 3-App Multi-Edition Branding, and Tenant Isolation.
 * Customize via environment variables (.env) or build-time VITE_APP_EDITION (admin | servant | parent | all).
 */

const readViteEnv = (getter, fallback = '') => {
    try {
        const value = getter();
        if (value !== undefined && value !== null && String(value).trim() !== '') {
            return String(value).trim();
        }
    } catch {
        // Safe fallback when imported in non-Vite Node.js test environments
    }
    return fallback;
};

export const VALID_APP_EDITIONS = ['admin', 'servant', 'parent', 'all'];
export const DEMO_EDITION_OVERRIDE_KEY = 'demo_app_edition_override';

export const normalizeEditionId = (value) => {
    const clean = String(value || '').trim().toLowerCase();
    return VALID_APP_EDITIONS.includes(clean) ? clean : 'all';
};

export const getBuildEdition = () => {
    const envEdition = readViteEnv(() => import.meta.env.VITE_APP_EDITION, '');
    if (envEdition) return normalizeEditionId(envEdition);
    const procEnvEdition = globalThis?.process?.env?.VITE_APP_EDITION;
    if (procEnvEdition) {
        return normalizeEditionId(procEnvEdition);
    }
    return 'all';
};

export const isStandaloneEditionBuild = () => getBuildEdition() !== 'all';

const BASE_STORAGE_PREFIX = readViteEnv(() => import.meta.env.VITE_STORAGE_PREFIX, 'st_barsoum_tahnasha_v1_');

export const getScopedStorageKey = (baseKey) => {
    return `${BASE_STORAGE_PREFIX}${String(baseKey || '').trim()}`;
};

export const UNSCOPED_LEGACY_COLLISION_KEYS = [
    'appSettings',
    'authorizedServants',
    'servants',
    'pendingStructureSync',
    'currentServant',
    'currentSyncKey',
    'assignedOsra',
    'masterSyncKey',
    'impersonated_osra',
    'isSuperAdminImpersonating',
    'userRole',
    'userPhone',
    'parentChildId',
    'parentChildName',
    'parentSyncKey',
    'parentClassName',
    'parentSession',
    'servantSession',
    'lastSyncTime',
    'selectedOsra',
];

const getStorageHandle = () => {
    try {
        return typeof window !== 'undefined' ? window?.localStorage : globalThis?.localStorage;
    } catch {
        return null;
    }
};

export const readScopedStorage = (baseKey) => {
    const ls = getStorageHandle();
    if (!ls) return null;
    const cleanKey = String(baseKey || '').trim();
    if (!cleanKey) return null;

    const scopedKey = getScopedStorageKey(cleanKey);
    const scopedVal = ls.getItem(scopedKey);
    if (scopedVal !== null && scopedVal !== undefined) {
        return scopedVal;
    }

    // Only allow unscoped fallback inside headless Node unit tests (no DOM document)
    if (typeof document === 'undefined') {
        const testFallback = ls.getItem(cleanKey);
        if (testFallback !== null && testFallback !== undefined) {
            return testFallback;
        }
    }
    return null;
};

export const writeScopedStorage = (baseKey, value) => {
    const ls = getStorageHandle();
    if (!ls) return false;
    const cleanKey = String(baseKey || '').trim();
    if (!cleanKey) return false;

    const scopedKey = getScopedStorageKey(cleanKey);
    ls.setItem(scopedKey, typeof value === 'string' ? value : JSON.stringify(value));
    return true;
};

export const removeScopedStorage = (baseKey) => {
    const ls = getStorageHandle();
    if (!ls) return;
    const cleanKey = String(baseKey || '').trim();
    if (!cleanKey) return;

    ls.removeItem(getScopedStorageKey(cleanKey));
    ls.removeItem(cleanKey);
};

export const purgeLegacyUnscopedBrowserStorage = () => {
    if (typeof document === 'undefined') return 0;
    const ls = getStorageHandle();
    if (!ls) return 0;

    let removedCount = 0;
    for (const key of UNSCOPED_LEGACY_COLLISION_KEYS) {
        if (ls.getItem(key) !== null) {
            ls.removeItem(key);
            removedCount += 1;
        }
    }
    return removedCount;
};

const safeReadBrowserStorage = (key) => {
    try {
        const ls = typeof window !== 'undefined' ? window?.localStorage : globalThis?.localStorage;
        const val = ls?.getItem?.(key);
        return val != null ? String(val) : '';
    } catch {
        return '';
    }
};

export const getDemoEditionOverride = () => {
    if (isStandaloneEditionBuild()) return '';
    const raw = normalizeEditionId(safeReadBrowserStorage(DEMO_EDITION_OVERRIDE_KEY));
    return raw === 'all' ? '' : raw;
};

export const setDemoEditionOverride = (editionId) => {
    if (isStandaloneEditionBuild()) return getBuildEdition();
    const normalized = normalizeEditionId(editionId);
    try {
        const ls = typeof window !== 'undefined' ? window?.localStorage : globalThis?.localStorage;
        if (normalized === 'all') {
            ls?.removeItem?.(DEMO_EDITION_OVERRIDE_KEY);
        } else {
            ls?.setItem?.(DEMO_EDITION_OVERRIDE_KEY, normalized);
        }
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new Event('edition-changed'));
        }
    } catch {
        // Ignore storage restrictions
    }
    return normalized;
};

export const getAppEdition = () => {
    const buildEdition = getBuildEdition();
    if (buildEdition !== 'all') return buildEdition;
    const override = getDemoEditionOverride();
    return override || 'all';
};

const rawPriests = readViteEnv(() => import.meta.env.VITE_CHURCH_PRIESTS, '');

const BASE_CHURCH_NAME = readViteEnv(() => import.meta.env.VITE_CHURCH_NAME, 'كنيسة الأنبا برسوم العريان بطهنشا');
const BASE_CHURCH_SHORT_NAME = readViteEnv(() => import.meta.env.VITE_CHURCH_SHORT_NAME, 'كنيسة الأنبا برسوم العريان - طهنشا');
const BASE_SERVICE_TITLE = readViteEnv(() => import.meta.env.VITE_SERVICE_TITLE, 'منظومة إدارة الخدمات ومدارس الأحد والمناهج');

export const EDITION_CONFIG = {
    admin: {
        id: 'admin',
        badgeLabel: 'أدمن',
        shortLabel: 'تطبيق الأدمن',
        title: 'تطبيق الأدمن والأمناء',
        subtitle: 'تطبيق الأدمن والأمناء • الأب الكاهن وأمين الخدمة وأمناء المراحل',
        appName: `${BASE_CHURCH_NAME} • الأدمن`,
        shortName: 'أدمن الأنبا برسوم',
        documentTitle: `أدمن | ${BASE_CHURCH_NAME}`,
        accentHex: '#1B2A59',
        badgeClass: 'bg-[#1B2A59] text-amber-200 border-amber-400/50',
        logoUrl: '/editions/admin/logo.png',
        pwaIconUrl: '/editions/admin/pwa-192x192.png',
        pwaIcon512Url: '/editions/admin/pwa-512x512.png',
        appleTouchIconUrl: '/editions/admin/apple-touch-icon.png',
        faviconUrl: '/editions/admin/favicon.ico',
        ogImageUrl: '/editions/admin/og-image.png',
        defaultStartRoute: '/',
        allowedDemoTiers: ['super_admin', 'stage_leader'],
    },
    servant: {
        id: 'servant',
        badgeLabel: 'خادم/ة',
        shortLabel: 'تطبيق الخادم/ة',
        title: 'تطبيق الخادم والخادمة',
        subtitle: 'تطبيق الخادم والخادمة • متابعة الأسرة، الحضور، الافتقاد والمناهج',
        appName: `${BASE_CHURCH_NAME} • الخدام`,
        shortName: 'خدام الأنبا برسوم',
        documentTitle: `خادم/ة | ${BASE_CHURCH_NAME}`,
        accentHex: '#0F4C3A',
        badgeClass: 'bg-[#0F4C3A] text-amber-100 border-amber-400/50',
        logoUrl: '/editions/servant/logo.png',
        pwaIconUrl: '/editions/servant/pwa-192x192.png',
        pwaIcon512Url: '/editions/servant/pwa-512x512.png',
        appleTouchIconUrl: '/editions/servant/apple-touch-icon.png',
        faviconUrl: '/editions/servant/favicon.ico',
        ogImageUrl: '/editions/servant/og-image.png',
        defaultStartRoute: '/',
        allowedDemoTiers: ['class_servant'],
    },
    parent: {
        id: 'parent',
        badgeLabel: 'ولي أمر',
        shortLabel: 'تطبيق ولي الأمر',
        title: 'بوابة ولي الأمر',
        subtitle: 'تطبيق ولي الأمر • متابعة الأبناء، سجل الحضور والنقاط والمناهج',
        appName: `${BASE_CHURCH_NAME} • ولي الأمر`,
        shortName: 'ولي أمر - الأنبا برسوم',
        documentTitle: `ولي أمر | ${BASE_CHURCH_NAME}`,
        accentHex: '#6B1D2F',
        badgeClass: 'bg-[#6B1D2F] text-amber-100 border-amber-400/50',
        logoUrl: '/editions/parent/logo.png',
        pwaIconUrl: '/editions/parent/pwa-192x192.png',
        pwaIcon512Url: '/editions/parent/pwa-512x512.png',
        appleTouchIconUrl: '/editions/parent/apple-touch-icon.png',
        faviconUrl: '/editions/parent/favicon.ico',
        ogImageUrl: '/editions/parent/og-image.png',
        defaultStartRoute: '/parent-login',
        allowedDemoTiers: ['parent'],
    },
    all: {
        id: 'all',
        badgeLabel: 'الكل',
        shortLabel: 'عرض شامل (الكل)',
        title: 'النسخة الشاملة (كل المستويات)',
        subtitle: BASE_SERVICE_TITLE,
        appName: BASE_CHURCH_NAME,
        shortName: BASE_CHURCH_SHORT_NAME,
        documentTitle: BASE_CHURCH_NAME,
        accentHex: '#1B2A59',
        badgeClass: 'bg-amber-500/20 text-amber-200 border-amber-400/40',
        logoUrl: '/logo.png',
        pwaIconUrl: '/pwa-192x192.png',
        pwaIcon512Url: '/pwa-512x512.png',
        appleTouchIconUrl: '/apple-touch-icon.png',
        faviconUrl: '/favicon.ico',
        ogImageUrl: '/og-image.png',
        defaultStartRoute: '/',
        allowedDemoTiers: ['super_admin', 'stage_leader', 'class_servant', 'parent'],
    },
};

export const mapRoleTierToBrandingEdition = (roleTier) => {
    const cleanTier = String(roleTier || '').trim().toLowerCase();
    if (cleanTier === 'super_admin' || cleanTier === 'stage_leader' || cleanTier === 'master_detailed' || cleanTier === 'stage_leader_detailed') {
        return 'admin';
    }
    if (cleanTier === 'class_servant' || cleanTier === 'osra_detailed') {
        return 'servant';
    }
    if (cleanTier === 'parent') {
        return 'parent';
    }
    return 'all';
};

export const getEffectiveBrandingEdition = (explicitRoleTier = '') => {
    const edition = getAppEdition();
    if (edition !== 'all') return edition;

    if (explicitRoleTier) {
        return mapRoleTierToBrandingEdition(explicitRoleTier);
    }

    const userRole = String(readScopedStorage('userRole') || '').trim().toLowerCase();
    const impersonated = String(readScopedStorage('impersonated_osra') || '').trim();
    const parentChildId = String(readScopedStorage('parentChildId') || '').trim();
    const currentSyncKey = String(readScopedStorage('currentSyncKey') || '').trim();

    if (userRole === 'parent' || (parentChildId && !currentSyncKey)) return 'parent';
    if (impersonated) return 'servant';
    if (userRole) return mapRoleTierToBrandingEdition(userRole);
    if (currentSyncKey === 'MASTER_ACCESS' || currentSyncKey === 'ADMIN_MODE' || currentSyncKey === 'STAGE_ADMIN') {
        return 'admin';
    }
    if (currentSyncKey) return 'servant';
    return 'all';
};

export const getEditionConfig = (explicitEditionId = '') => {
    if (explicitEditionId && EDITION_CONFIG[explicitEditionId]) {
        return EDITION_CONFIG[explicitEditionId];
    }
    const resolved = getEffectiveBrandingEdition();
    return EDITION_CONFIG[resolved] || EDITION_CONFIG.all;
};

export const getActiveLogoUrl = (explicitEditionId = '') => {
    return getEditionConfig(explicitEditionId).logoUrl;
};

export const getPwaIconUrl = (explicitEditionId = '') => {
    return getEditionConfig(explicitEditionId).pwaIconUrl;
};

const GENERIC_CHURCH_LOGO_PATHS = new Set([
    '/logo.png',
    'logo.png',
    '/pwa-192x192.png',
    '/pwa-512x512.png',
    '/icon.png',
    '/editions/admin/logo.png',
    '/editions/servant/logo.png',
    '/editions/parent/logo.png',
]);

export const getLogoUrl = (customLogo = '') => {
    const clean = String(customLogo || '').trim();
    if (clean && !GENERIC_CHURCH_LOGO_PATHS.has(clean)) {
        return clean;
    }
    return getActiveLogoUrl();
};

export const applyEditionBrandingToDOM = (explicitRoleTier = '') => {
    if (typeof document === 'undefined') return null;

    const appEdition = getAppEdition();
    const brandingId = getEffectiveBrandingEdition(explicitRoleTier);
    const cfg = EDITION_CONFIG[brandingId] || EDITION_CONFIG.all;

    document.title = cfg.documentTitle;
    if (document.documentElement) {
        document.documentElement.dataset.appEdition = appEdition;
        document.documentElement.dataset.brandingEdition = brandingId;
    }

    const iconLinks = document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"], link[rel="alternate icon"]');
    if (iconLinks.length > 0) {
        iconLinks.forEach((link) => {
            const typeAttr = String(link.getAttribute('type') || '').toLowerCase();
            if (typeAttr.includes('png')) {
                link.setAttribute('href', cfg.pwaIconUrl || cfg.logoUrl);
            } else {
                link.setAttribute('href', cfg.faviconUrl || cfg.pwaIconUrl);
            }
        });
    } else if (document.head) {
        const link = document.createElement('link');
        link.rel = 'icon';
        link.type = 'image/png';
        link.href = cfg.pwaIconUrl || cfg.logoUrl;
        document.head.appendChild(link);
    }

    const appleLink = document.querySelector('link[rel="apple-touch-icon"]');
    if (appleLink && cfg.appleTouchIconUrl) {
        appleLink.setAttribute('href', cfg.appleTouchIconUrl);
    }

    const appleTitleMeta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (appleTitleMeta) {
        appleTitleMeta.setAttribute('content', cfg.documentTitle);
    }

    return cfg;
};

export const TENANT_CONFIG = {
    tenantId: readViteEnv(() => import.meta.env.VITE_TENANT_ID, 'st-barsoum-tahnasha'),
    churchName: BASE_CHURCH_NAME,
    churchShortName: BASE_CHURCH_SHORT_NAME,
    serviceTitle: BASE_SERVICE_TITLE,
    dioceseName: readViteEnv(() => import.meta.env.VITE_DIOCESE_NAME, 'مطرانية المنيا للأقباط الأرثوذكس'),
    logoUrl: readViteEnv(() => import.meta.env.VITE_APP_LOGO_URL, getActiveLogoUrl()),
    pwaIconUrl: readViteEnv(() => import.meta.env.VITE_PWA_ICON_URL, getPwaIconUrl()),
    localDbName: readViteEnv(() => import.meta.env.VITE_LOCAL_DB_NAME, 'StBarsoumTahnashaDB_V1'),
    storagePrefix: BASE_STORAGE_PREFIX,
    priestNames: rawPriests
        ? rawPriests.split(',').map(s => s.trim()).filter(Boolean)
        : [],
    footerCredit: readViteEnv(() => import.meta.env.VITE_FOOTER_CREDIT, 'Arsany Zika'),
    cloudinaryCloudName: readViteEnv(() => import.meta.env.VITE_CLOUDINARY_CLOUD_NAME, ''),
    cloudinaryUploadPreset: readViteEnv(() => import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET, ''),

    // Aliases for component convenience and uniform upper/camel usage across modules
    APP_NAME: BASE_CHURCH_NAME,
    CHURCH_NAME: BASE_CHURCH_NAME,
    CHURCH_SHORT_NAME: BASE_CHURCH_SHORT_NAME,
    DEFAULT_KHEDMA_LOGO: readViteEnv(() => import.meta.env.VITE_APP_LOGO_URL, getActiveLogoUrl()),
    DEFAULT_OSRA_LOGO: readViteEnv(() => import.meta.env.VITE_DEFAULT_OSRA_LOGO, getActiveLogoUrl()),
    APK_DOWNLOAD_LINK: readViteEnv(() => import.meta.env.VITE_APK_DOWNLOAD_LINK, ''),
    MASTER_VIEW_NAME: readViteEnv(() => import.meta.env.VITE_MASTER_VIEW_NAME, 'كل الخدمة'),
    QR_INVALID_MESSAGE: 'بطاقة غير صالحة',
};

export const getHeaderBranding = (appSettings = {}) => ({
    title: String(appSettings?.khedmaName || '').trim() || TENANT_CONFIG.churchName,
    subtitle: TENANT_CONFIG.serviceTitle,
    logoUrl: getLogoUrl(appSettings?.osraLogo || appSettings?.khedmaLogo),
});

export const getReportHeaderTitle = (reportTitle = '') => {
    const cleanReport = String(reportTitle || '').trim();
    return cleanReport ? `${cleanReport} - ${TENANT_CONFIG.churchName}` : TENANT_CONFIG.churchName;
};

export const getExcelReportFilename = (prefix = 'تقرير_الخدمة', suffix = '') => {
    const safePrefix = String(prefix || 'تقرير_الخدمة').trim().replace(/[\\/:*?"<>|]/g, '_');
    const safeTenant = String(TENANT_CONFIG.tenantId || 'church').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeSuffix = String(suffix || '').trim().replace(/[\\/:*?"<>|]/g, '_');
    return [safePrefix, safeTenant, safeSuffix].filter(Boolean).join('_') + '.xlsx';
};

export const getQrCardBranding = (appSettings = {}) => ({
    churchName: TENANT_CONFIG.churchName,
    serviceTitle: String(appSettings?.khedmaName || '').trim() || TENANT_CONFIG.churchShortName,
    className: String(appSettings?.osraName || '').trim(),
    logoUrl: getLogoUrl(appSettings?.osraLogo || appSettings?.khedmaLogo),
    footerNote: TENANT_CONFIG.serviceTitle,
});

export const getNotificationTitle = (scopeTitle = '') => {
    const cleanScope = String(scopeTitle || '').trim();
    return cleanScope
        ? `إشعار ${TENANT_CONFIG.churchShortName} (${cleanScope})`
        : TENANT_CONFIG.churchName;
};
