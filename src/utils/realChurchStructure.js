// src/utils/realChurchStructure.js
// الهيكل الإنتاجي الرسمي المعتمد لخدمات وفصول كنيسة الأنبا برسوم العريان بطهنشا
// (9 خدمات رئيسية • 20 فصل وأسرة • مواعيد الخدمة الدقيقة • مفتاح فريد لكل أسرة • شعار افتراضي موحد)

export const DEFAULT_CHURCH_LOGO_PATH = '/logo.png';

export const SUNDAY_SCHOOL_SERVANTS_CUSTOM_SESSIONS = [
    {
        id: 'service_sunday',
        key: 'service_sunday',
        label: 'خدمة الأحد',
        type: 'service',
        dayKey: 'sunday',
        points: 10
    },
    {
        id: 'service_thursday',
        key: 'service_thursday',
        label: 'خدمة الخميس',
        type: 'service',
        dayKey: 'thursday',
        points: 10
    },
    {
        id: 'liturgy_friday',
        key: 'liturgy_friday',
        label: 'قداس الجمعة',
        type: 'liturgy',
        dayKey: 'friday',
        points: 15
    },
    {
        id: 'service_meeting_wednesday',
        key: 'service_meeting_wednesday',
        label: 'اجتماع الخدمة (الأربعاء)',
        type: 'service_meeting',
        dayKey: 'wednesday',
        points: 10
    },
    {
        id: 'tasbeha_thursday',
        key: 'tasbeha_thursday',
        label: 'التسبحة (الخميس)',
        type: 'tasbeha',
        dayKey: 'thursday',
        points: 10
    }
];

function inferPrefixCode(seedText = '') {
    const t = String(seedText || '').trim().toLowerCase();
    if (t.includes('حضان') || t.includes('تمهيد') || t.includes('kg') || t.includes('كي جي')) return 'NUR';
    if (t.includes('خدام مدارس')) return 'SSS';
    if (t.includes('أمهات') || t.includes('امهات')) return 'MTH';
    if (t.includes('آباء') || t.includes('اباء')) return 'FTH';
    if (t.includes('خدام العام') || t.includes('الخدام العام')) return 'GSV';
    if (t.includes('ابتدائ')) return 'PRI';
    if (t.includes('إعداد') || t.includes('اعداد')) return 'PRP';
    if (t.includes('ثانو')) return 'SEC';
    if (t.includes('جامع') || t.includes('شباب')) return 'UNI';
    return 'CLS';
}

const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Generates a unique, church-branded Access/Registration Key (`osraKey` / `secretKey`)
 * e.g. `AB-CLS-7K4M` guaranteed not to collide with `existingKeys`.
 */
export function generateUniqueOsraKey(seedText = '', existingKeys = [], forceRandom = false) {
    const used = new Set(
        (Array.isArray(existingKeys) ? existingKeys : Array.from(existingKeys || []))
            .map((k) => String(k || '').trim().toUpperCase())
            .filter(Boolean)
    );
    const prefix = inferPrefixCode(seedText);

    if (!forceRandom) {
        for (let idx = 1; idx <= 99; idx += 1) {
            const candidate = `AB-${prefix}-${String(idx).padStart(2, '0')}`;
            if (!used.has(candidate)) return candidate;
        }
    }

    for (let attempt = 0; attempt < 200; attempt += 1) {
        let token = '';
        for (let i = 0; i < 4; i += 1) {
            token += KEY_ALPHABET[Math.floor(Math.random() * KEY_ALPHABET.length)];
        }
        const candidate = `AB-${prefix}-${token}`;
        if (!used.has(candidate)) return candidate;
    }

    return `AB-${prefix}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
}

/**
 * Extracts all existing osraKey/secretKey values across services to avoid collisions.
 */
export function collectExistingOsraKeys(services = []) {
    const keys = new Set();
    for (const svc of (Array.isArray(services) ? services : [])) {
        for (const osra of (svc?.osras || [])) {
            const k1 = String(osra?.osraKey || '').trim().toUpperCase();
            const k2 = String(osra?.secretKey || '').trim().toUpperCase();
            if (k1) keys.add(k1);
            if (k2) keys.add(k2);
        }
    }
    return keys;
}

/**
 * Checks whether a class/service has a custom uploaded logo (as opposed to the default church logo).
 */
export function hasCustomOsraLogo(osra = null) {
    if (!osra || typeof osra !== 'object') return false;
    const candidate = String(osra.customLogoUrl || osra.logoUrl || osra.logo || '').trim();
    if (!candidate) return false;
    if (candidate === DEFAULT_CHURCH_LOGO_PATH) return false;
    if (/^\/editions\/[^/]+\/logo\.png$/i.test(candidate)) return false;
    return true;
}

/**
 * Resolves the effective logo URL for an Osra/Class, seamlessly preferring a custom logo
 * and falling back to the parent service logo or official Church default logo (`/logo.png`).
 */
export function resolveOsraLogoUrl(osra = null, service = null, fallbackLogo = DEFAULT_CHURCH_LOGO_PATH) {
    if (osra && typeof osra === 'object') {
        const custom = String(osra.customLogoUrl || osra.logoUrl || '').trim();
        if (custom) return custom;
        const direct = String(osra.logo || '').trim();
        if (direct) return direct;
    }
    if (service && typeof service === 'object') {
        const svcCustom = String(service.customLogoUrl || service.logoUrl || '').trim();
        if (svcCustom) return svcCustom;
        const svcLogo = String(service.logo || '').trim();
        if (svcLogo) return svcLogo;
    }
    if (osra && typeof osra === 'object' && osra.defaultLogo) {
        return String(osra.defaultLogo).trim() || DEFAULT_CHURCH_LOGO_PATH;
    }
    return fallbackLogo || DEFAULT_CHURCH_LOGO_PATH;
}

function makeProductionOsra({
    id,
    name,
    syncKey,
    osraKey,
    serviceName,
    serviceGroup,
    stageName,
    serviceDays,
    liturgyDays,
    scheduleLabel,
    isServantsRoster = false,
    customSessions = undefined
}) {
    const base = {
        id,
        name,
        syncKey: syncKey || name,
        osraKey,
        secretKey: osraKey,
        serviceName,
        serviceGroup,
        stageName,
        amin: '',
        defaultLogo: DEFAULT_CHURCH_LOGO_PATH,
        logo: DEFAULT_CHURCH_LOGO_PATH,
        customLogoUrl: '',
        logoUrl: '',
        serviceDays: [...serviceDays],
        liturgyDays: [...liturgyDays],
        liturgyDay: liturgyDays.length > 0 ? liturgyDays[0] : '',
        scheduleLabel,
        useCustomSchedule: Boolean(customSessions && customSessions.length > 0),
        isServantsRoster: Boolean(isServantsRoster),
        curricula: [],
        lessons: []
    };
    if (Array.isArray(customSessions) && customSessions.length > 0) {
        base.customSessions = customSessions.map((s) => ({ ...s }));
    }
    return base;
}

export const REAL_CHURCH_SERVICES = [
    {
        id: 'srv_nursery',
        name: 'خدمة حضانة',
        serviceGroup: 'حضانة',
        priest: '',
        defaultLogo: DEFAULT_CHURCH_LOGO_PATH,
        logo: DEFAULT_CHURCH_LOGO_PATH,
        serviceDays: ['sunday', 'thursday'],
        liturgyDays: ['friday'],
        liturgyDay: 'friday',
        scheduleLabel: 'الأحد والخميس • قداس الجمعة',
        osras: [
            makeProductionOsra({
                id: 'osra_nur_tamhidy',
                name: 'تمهيدي',
                syncKey: 'تمهيدي',
                osraKey: 'AB-NUR-01',
                serviceName: 'خدمة حضانة',
                serviceGroup: 'حضانة',
                stageName: 'حضانة / كي جي',
                serviceDays: ['sunday', 'thursday'],
                liturgyDays: ['friday'],
                scheduleLabel: 'الأحد والخميس • قداس الجمعة'
            }),
            makeProductionOsra({
                id: 'osra_nur_kg1',
                name: 'KG1',
                syncKey: 'KG1',
                osraKey: 'AB-NUR-02',
                serviceName: 'خدمة حضانة',
                serviceGroup: 'حضانة',
                stageName: 'حضانة / كي جي',
                serviceDays: ['sunday', 'thursday'],
                liturgyDays: ['friday'],
                scheduleLabel: 'الأحد والخميس • قداس الجمعة'
            }),
            makeProductionOsra({
                id: 'osra_nur_kg2',
                name: 'KG2',
                syncKey: 'KG2',
                osraKey: 'AB-NUR-03',
                serviceName: 'خدمة حضانة',
                serviceGroup: 'حضانة',
                stageName: 'حضانة / كي جي',
                serviceDays: ['sunday', 'thursday'],
                liturgyDays: ['friday'],
                scheduleLabel: 'الأحد والخميس • قداس الجمعة'
            })
        ]
    },
    {
        id: 'srv_primary',
        name: 'خدمة ابتدائي',
        serviceGroup: 'ابتدائي',
        priest: '',
        defaultLogo: DEFAULT_CHURCH_LOGO_PATH,
        logo: DEFAULT_CHURCH_LOGO_PATH,
        serviceDays: ['sunday', 'thursday'],
        liturgyDays: ['friday'],
        liturgyDay: 'friday',
        scheduleLabel: 'الأحد والخميس • قداس الجمعة',
        osras: [
            makeProductionOsra({
                id: 'osra_pri_1',
                name: 'أولى ابتدائي',
                syncKey: 'أولى ابتدائي',
                osraKey: 'AB-PRI-01',
                serviceName: 'خدمة ابتدائي',
                serviceGroup: 'ابتدائي',
                stageName: 'ابتدائي',
                serviceDays: ['sunday', 'thursday'],
                liturgyDays: ['friday'],
                scheduleLabel: 'الأحد والخميس • قداس الجمعة'
            }),
            makeProductionOsra({
                id: 'osra_pri_2',
                name: 'تانية ابتدائي',
                syncKey: 'تانية ابتدائي',
                osraKey: 'AB-PRI-02',
                serviceName: 'خدمة ابتدائي',
                serviceGroup: 'ابتدائي',
                stageName: 'ابتدائي',
                serviceDays: ['sunday', 'thursday'],
                liturgyDays: ['friday'],
                scheduleLabel: 'الأحد والخميس • قداس الجمعة'
            }),
            makeProductionOsra({
                id: 'osra_pri_3',
                name: 'تالتة ابتدائي',
                syncKey: 'تالتة ابتدائي',
                osraKey: 'AB-PRI-03',
                serviceName: 'خدمة ابتدائي',
                serviceGroup: 'ابتدائي',
                stageName: 'ابتدائي',
                serviceDays: ['sunday', 'thursday'],
                liturgyDays: ['friday'],
                scheduleLabel: 'الأحد والخميس • قداس الجمعة'
            }),
            makeProductionOsra({
                id: 'osra_pri_4',
                name: 'رابعة ابتدائي',
                syncKey: 'رابعة ابتدائي',
                osraKey: 'AB-PRI-04',
                serviceName: 'خدمة ابتدائي',
                serviceGroup: 'ابتدائي',
                stageName: 'ابتدائي',
                serviceDays: ['sunday', 'thursday'],
                liturgyDays: ['friday'],
                scheduleLabel: 'الأحد والخميس • قداس الجمعة'
            }),
            makeProductionOsra({
                id: 'osra_pri_5',
                name: 'خامسة ابتدائي',
                syncKey: 'خامسة ابتدائي',
                osraKey: 'AB-PRI-05',
                serviceName: 'خدمة ابتدائي',
                serviceGroup: 'ابتدائي',
                stageName: 'ابتدائي',
                serviceDays: ['sunday', 'thursday'],
                liturgyDays: ['friday'],
                scheduleLabel: 'الأحد والخميس • قداس الجمعة'
            }),
            makeProductionOsra({
                id: 'osra_pri_6',
                name: 'سادسة ابتدائي',
                syncKey: 'سادسة ابتدائي',
                osraKey: 'AB-PRI-06',
                serviceName: 'خدمة ابتدائي',
                serviceGroup: 'ابتدائي',
                stageName: 'ابتدائي',
                serviceDays: ['sunday', 'thursday'],
                liturgyDays: ['friday'],
                scheduleLabel: 'الأحد والخميس • قداس الجمعة'
            })
        ]
    },
    {
        id: 'srv_prep',
        name: 'خدمة إعدادي',
        serviceGroup: 'إعدادي',
        priest: '',
        defaultLogo: DEFAULT_CHURCH_LOGO_PATH,
        logo: DEFAULT_CHURCH_LOGO_PATH,
        serviceDays: ['friday'],
        liturgyDays: ['friday'],
        liturgyDay: 'friday',
        scheduleLabel: 'الجمعة • قداس الجمعة',
        osras: [
            makeProductionOsra({
                id: 'osra_prep_1',
                name: 'أولى إعدادي',
                syncKey: 'أولى إعدادي',
                osraKey: 'AB-PRP-01',
                serviceName: 'خدمة إعدادي',
                serviceGroup: 'إعدادي',
                stageName: 'إعدادي',
                serviceDays: ['friday'],
                liturgyDays: ['friday'],
                scheduleLabel: 'الجمعة • قداس الجمعة'
            }),
            makeProductionOsra({
                id: 'osra_prep_2',
                name: 'تانية إعدادي',
                syncKey: 'تانية إعدادي',
                osraKey: 'AB-PRP-02',
                serviceName: 'خدمة إعدادي',
                serviceGroup: 'إعدادي',
                stageName: 'إعدادي',
                serviceDays: ['friday'],
                liturgyDays: ['friday'],
                scheduleLabel: 'الجمعة • قداس الجمعة'
            }),
            makeProductionOsra({
                id: 'osra_prep_3',
                name: 'تالتة إعدادي',
                syncKey: 'تالتة إعدادي',
                osraKey: 'AB-PRP-03',
                serviceName: 'خدمة إعدادي',
                serviceGroup: 'إعدادي',
                stageName: 'إعدادي',
                serviceDays: ['friday'],
                liturgyDays: ['friday'],
                scheduleLabel: 'الجمعة • قداس الجمعة'
            })
        ]
    },
    {
        id: 'srv_secondary',
        name: 'خدمة ثانوي',
        serviceGroup: 'ثانوي',
        priest: '',
        defaultLogo: DEFAULT_CHURCH_LOGO_PATH,
        logo: DEFAULT_CHURCH_LOGO_PATH,
        serviceDays: ['thursday'],
        liturgyDays: ['friday'],
        liturgyDay: 'friday',
        scheduleLabel: 'الخميس • قداس الجمعة',
        osras: [
            makeProductionOsra({
                id: 'osra_sec_1',
                name: 'أولى ثانوي',
                syncKey: 'أولى ثانوي',
                osraKey: 'AB-SEC-01',
                serviceName: 'خدمة ثانوي',
                serviceGroup: 'ثانوي',
                stageName: 'ثانوي',
                serviceDays: ['thursday'],
                liturgyDays: ['friday'],
                scheduleLabel: 'الخميس • قداس الجمعة'
            }),
            makeProductionOsra({
                id: 'osra_sec_2',
                name: 'تانية ثانوي',
                syncKey: 'تانية ثانوي',
                osraKey: 'AB-SEC-02',
                serviceName: 'خدمة ثانوي',
                serviceGroup: 'ثانوي',
                stageName: 'ثانوي',
                serviceDays: ['thursday'],
                liturgyDays: ['friday'],
                scheduleLabel: 'الخميس • قداس الجمعة'
            }),
            makeProductionOsra({
                id: 'osra_sec_3',
                name: 'تالتة ثانوي',
                syncKey: 'تالتة ثانوي',
                osraKey: 'AB-SEC-03',
                serviceName: 'خدمة ثانوي',
                serviceGroup: 'ثانوي',
                stageName: 'ثانوي',
                serviceDays: ['thursday'],
                liturgyDays: ['friday'],
                scheduleLabel: 'الخميس • قداس الجمعة'
            })
        ]
    },
    {
        id: 'srv_university',
        name: 'خدمة جامعة',
        serviceGroup: 'جامعة',
        priest: '',
        defaultLogo: DEFAULT_CHURCH_LOGO_PATH,
        logo: DEFAULT_CHURCH_LOGO_PATH,
        serviceDays: ['monday'],
        liturgyDays: [],
        liturgyDay: '',
        scheduleLabel: 'الاثنين',
        osras: [
            makeProductionOsra({
                id: 'osra_uni_1',
                name: 'جامعة',
                syncKey: 'جامعة',
                osraKey: 'AB-UNI-01',
                serviceName: 'خدمة جامعة',
                serviceGroup: 'جامعة',
                stageName: 'شباب وجامعة',
                serviceDays: ['monday'],
                liturgyDays: [],
                scheduleLabel: 'الاثنين'
            })
        ]
    },
    {
        id: 'srv_general_servants',
        name: 'إجتماع الخدام العام',
        serviceGroup: 'الخدام',
        priest: '',
        defaultLogo: DEFAULT_CHURCH_LOGO_PATH,
        logo: DEFAULT_CHURCH_LOGO_PATH,
        serviceDays: ['wednesday'],
        liturgyDays: [],
        liturgyDay: '',
        scheduleLabel: 'الأربعاء',
        osras: [
            makeProductionOsra({
                id: 'osra_gen_servants',
                name: 'إجتماع الخدام العام',
                syncKey: 'إجتماع الخدام العام',
                osraKey: 'AB-GSV-01',
                serviceName: 'إجتماع الخدام العام',
                serviceGroup: 'الخدام',
                stageName: 'اجتماع الخدام العام',
                serviceDays: ['wednesday'],
                liturgyDays: [],
                scheduleLabel: 'الأربعاء',
                isServantsRoster: true
            })
        ]
    },
    {
        id: 'srv_ss_servants',
        name: 'خدام مدارس الأحد',
        serviceGroup: 'خدام مدارس الأحد',
        priest: '',
        defaultLogo: DEFAULT_CHURCH_LOGO_PATH,
        logo: DEFAULT_CHURCH_LOGO_PATH,
        serviceDays: ['sunday', 'thursday', 'wednesday'],
        liturgyDays: ['friday'],
        liturgyDay: 'friday',
        scheduleLabel: 'الأحد والخميس • قداس الجمعة • اجتماع الأربعاء • تسبحة الخميس',
        customSessions: SUNDAY_SCHOOL_SERVANTS_CUSTOM_SESSIONS.map((s) => ({ ...s })),
        osras: [
            makeProductionOsra({
                id: 'osra_ss_servants',
                name: 'خدام مدارس الأحد',
                syncKey: 'خدام مدارس الأحد',
                osraKey: 'AB-SSS-01',
                serviceName: 'خدام مدارس الأحد',
                serviceGroup: 'خدام مدارس الأحد',
                stageName: 'خدام مدارس الأحد',
                serviceDays: ['sunday', 'thursday', 'wednesday'],
                liturgyDays: ['friday'],
                scheduleLabel: 'الأحد والخميس • قداس الجمعة • اجتماع الأربعاء • تسبحة الخميس',
                isServantsRoster: true,
                customSessions: SUNDAY_SCHOOL_SERVANTS_CUSTOM_SESSIONS
            })
        ]
    },
    {
        id: 'srv_ss_mothers',
        name: 'إجتماع أمهات مدارس الأحد',
        serviceGroup: 'الأمهات',
        priest: '',
        defaultLogo: DEFAULT_CHURCH_LOGO_PATH,
        logo: DEFAULT_CHURCH_LOGO_PATH,
        serviceDays: ['friday'],
        liturgyDays: [],
        liturgyDay: '',
        scheduleLabel: 'الجمعة',
        osras: [
            makeProductionOsra({
                id: 'osra_ss_mothers',
                name: 'إجتماع أمهات مدارس الأحد',
                syncKey: 'إجتماع أمهات مدارس الأحد',
                osraKey: 'AB-MTH-01',
                serviceName: 'إجتماع أمهات مدارس الأحد',
                serviceGroup: 'الأمهات',
                stageName: 'خدمات أخرى',
                serviceDays: ['friday'],
                liturgyDays: [],
                scheduleLabel: 'الجمعة'
            })
        ]
    },
    {
        id: 'srv_fathers',
        name: 'إجتماع الآباء',
        serviceGroup: 'الآباء',
        priest: '',
        defaultLogo: DEFAULT_CHURCH_LOGO_PATH,
        logo: DEFAULT_CHURCH_LOGO_PATH,
        serviceDays: ['friday'],
        liturgyDays: [],
        liturgyDay: '',
        scheduleLabel: 'الجمعة',
        osras: [
            makeProductionOsra({
                id: 'osra_fathers',
                name: 'إجتماع الآباء',
                syncKey: 'إجتماع الآباء',
                osraKey: 'AB-FTH-01',
                serviceName: 'إجتماع الآباء',
                serviceGroup: 'الآباء',
                stageName: 'خدمات أخرى',
                serviceDays: ['friday'],
                liturgyDays: [],
                scheduleLabel: 'الجمعة'
            })
        ]
    }
];

export const REAL_CHURCH_OSRAS = REAL_CHURCH_SERVICES.flatMap((s) => s.osras);
