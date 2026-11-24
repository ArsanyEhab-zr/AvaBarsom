// src/utils/whatsappHelper.js
// مساعد رسائل الواتساب الرسمية لقبول وتفعيل الخدام — كنيسة الأنبا برسوم العريان بطهنشا (0 Emojis)

const ARABIC_INDIC_MAP = {
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
    '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
    '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9'
};

export function toAsciiDigits(input = '') {
    return String(input ?? '').replace(/[٠-٩۰-۹]/g, (ch) => ARABIC_INDIC_MAP[ch] ?? ch);
}

/**
 * Normalizes an Egyptian mobile/phone number for WhatsApp `https://wa.me/<number>`:
 * - Strips spaces, dashes, parentheses, plus signs, and non-digits
 * - Converts `0020...`, `+20 01...`, `01...`, or `1...` cleanly to `201...`
 */
export function normalizeEgyptWhatsAppPhone(rawPhone = '') {
    let digits = toAsciiDigits(rawPhone).replace(/\D/g, '');
    if (!digits) return '';

    if (digits.startsWith('00')) {
        digits = digits.slice(2);
    }
    if (digits.startsWith('200') && digits.length >= 13) {
        // Common typo: +20 012... -> 20012... -> 2012...
        digits = '20' + digits.slice(3);
    } else if (digits.startsWith('0')) {
        digits = '20' + digits.replace(/^0+/, '');
    } else if (digits.length === 10 && digits.startsWith('1')) {
        digits = '20' + digits;
    } else if (!digits.startsWith('20') && digits.length >= 9 && digits.length <= 11) {
        digits = '20' + digits;
    }

    return digits;
}

/**
 * Formats the servant's login phone cleanly for display inside the acceptance message (e.g. `012...`).
 */
export function formatServantDisplayPhone(rawPhone = '') {
    const clean = toAsciiDigits(rawPhone).replace(/[^\d+]/g, '').trim();
    if (!clean) return 'غير مسجل';
    const digits = clean.replace(/\D/g, '');
    if (digits.startsWith('20') && digits.length === 12) {
        return '0' + digits.slice(2);
    }
    if (digits.length === 10 && digits.startsWith('1')) {
        return '0' + digits;
    }
    return digits || clean;
}

function isLocalhostUrl(urlStr = '') {
    const u = String(urlStr || '').trim().toLowerCase();
    if (!u) return true;
    return u.includes('localhost') || u.includes('127.0.0.1') || u.includes('0.0.0.0');
}

/**
 * Resolves the production Servant App URL cleanly:
 * 1. `VITE_SERVANT_APP_URL` environment variable (when non-localhost)
 * 2. Explicit `appUrl` override if non-localhost
 * 3. Browser `window.location.origin` when deployed on production (Vercel / custom domain, never localhost)
 * 4. Production fallback URL
 */
export function resolveServantAppUrl(explicitUrl = '') {
    const candidates = [
        explicitUrl,
        typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_SERVANT_APP_URL : '',
        typeof globalThis !== 'undefined' && globalThis.process?.env ? globalThis.process.env.VITE_SERVANT_APP_URL : '',
        typeof window !== 'undefined' && window.location ? window.location.origin : ''
    ];

    for (const raw of candidates) {
        const trimmed = String(raw || '').trim().replace(/\/+$/, '');
        if (trimmed && /^https?:\/\//i.test(trimmed) && !isLocalhostUrl(trimmed)) {
            return trimmed;
        }
    }

    return 'https://anba-barsoum-servant.vercel.app';
}

export function formatServantRoleLabel(role = '', syncKey = '') {
    const r = String(role || '').trim();
    const sk = String(syncKey || '').trim();

    if (sk === 'STAGE_ADMIN' || r.includes('مرحلة')) return 'أمين مرحلة';
    if (r === 'كاهن' || r.includes('كاهن')) return 'أب كاهن';
    if (r.includes('أمين أسرة') || r.includes('امين اسرة')) return 'أمين أسرة';
    if (r.includes('أمين خدمة') || r.includes('أدمن')) return r;
    if (!r || r === 'خادم' || r === 'خادم عادي' || r === 'تاسوني' || r === 'خادم فصل') {
        return 'خادم فصل';
    }
    return r;
}

function safeCleanField(value, fallback) {
    const str = String(value ?? '').trim();
    if (!str || str === 'undefined' || str === 'null') return fallback;
    return str;
}

/**
 * Resolves full servant + class metadata (serviceName, osraName, osraKey, roleLabel, loginPhone)
 * from `servicesList` so zero fields are ever blank or `undefined`.
 */
export function resolveServantWhatsappContext(servant = {}, servicesList = [], explicitAppUrl = '') {
    const sObj = servant && typeof servant === 'object' ? servant : {};
    const targetSyncKey = String(sObj.syncKey || '').trim();
    const targetOsraName = String(sObj.osraName || sObj.assignedOsra || '').trim();

    let matchedService = null;
    let matchedOsra = null;

    if (Array.isArray(servicesList)) {
        for (const svc of servicesList) {
            for (const osra of (svc?.osras || [])) {
                const oSync = String(osra?.syncKey || '').trim();
                const oName = String(osra?.name || '').trim();
                const oKey = String(osra?.osraKey || osra?.secretKey || '').trim();
                if (
                    (targetSyncKey && (oSync === targetSyncKey || oKey === targetSyncKey)) ||
                    (targetOsraName && oName === targetOsraName)
                ) {
                    matchedService = svc;
                    matchedOsra = osra;
                    break;
                }
            }
            if (matchedOsra) break;
        }
    }

    const servantName = safeCleanField(sObj.name, 'خادم الكنيسة');
    const roleLabel = formatServantRoleLabel(sObj.role, targetSyncKey);

    const isAllChurch = targetSyncKey === 'MASTER_ACCESS' || targetSyncKey === 'ADMIN_MODE';
    const isStageLeader = targetSyncKey === 'STAGE_ADMIN' || roleLabel === 'أمين مرحلة';

    const serviceName = safeCleanField(
        sObj.serviceName || matchedService?.name || sObj.stageName || (isAllChurch ? 'الخدمة العامة بالكنيسة' : ''),
        isStageLeader ? 'خدمة المرحلة' : 'خدمة مدارس الأحد والتربية الكنسية'
    );

    const osraName = safeCleanField(
        matchedOsra?.name || sObj.osraName || sObj.assignedOsra,
        isAllChurch ? 'كل فصول وأسر الكنيسة' : (isStageLeader ? 'فصول المرحلة المخصصة' : serviceName)
    );

    const uniqueOsraKey = safeCleanField(
        sObj.osraKey || sObj.secretKey || matchedOsra?.osraKey || matchedOsra?.secretKey || targetSyncKey,
        'AB-CLS-01'
    );

    const loginPhone = formatServantDisplayPhone(sObj.phone);
    const whatsappPhone = normalizeEgyptWhatsAppPhone(sObj.phone);
    const servantAppUrl = resolveServantAppUrl(explicitAppUrl);

    return {
        servantName,
        serviceName,
        osraName,
        roleLabel,
        loginPhone,
        whatsappPhone,
        uniqueOsraKey,
        servantAppUrl
    };
}

/**
 * Builds the official church-branded Arabic WhatsApp acceptance message (`0 Emojis`).
 */
export function buildServantApprovalWhatsAppMessage(servant = {}, servicesList = [], explicitAppUrl = '') {
    const ctx = resolveServantWhatsappContext(servant, servicesList, explicitAppUrl);

    return [
        `سلام ونعمة يا ${ctx.servantName}،`,
        `نرحب بك في خدمة كنيسة الأنبا برسوم العريان بطهنشا.`,
        `تمت الموافقة على طلب انضمامك وتفعيل حسابك بنجاح بالبيانات التالية:`,
        ``,
        `- الخدمة: ${ctx.serviceName}`,
        `- الأسرة / الفصل: ${ctx.osraName}`,
        `- الصلاحية: ${ctx.roleLabel}`,
        `- رقم الدخول المسجل: ${ctx.loginPhone}`,
        `- مفتاح الأسرة الخاص: ${ctx.uniqueOsraKey}`,
        ``,
        `يمكنك الآن الدخول إلى تطبيق الخدام لمتابعة الغياب والمنهج والافتقاد من خلال الرابط:`,
        `${ctx.servantAppUrl}`,
        ``,
        `ربنا يبارك خدمتك ويعوض تعب محبتك.`
    ].join('\n');
}

/**
 * Builds a complete `https://wa.me/<20...>?text=...` URL for servant approval/activation.
 */
export function buildServantApprovalWhatsAppUrl(servant = {}, servicesList = [], explicitAppUrl = '') {
    const ctx = resolveServantWhatsappContext(servant, servicesList, explicitAppUrl);
    const message = buildServantApprovalWhatsAppMessage(servant, servicesList, explicitAppUrl);
    if (!ctx.whatsappPhone) return '';
    return `https://wa.me/${ctx.whatsappPhone}?text=${encodeURIComponent(message)}`;
}
