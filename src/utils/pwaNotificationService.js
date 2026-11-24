// src/utils/pwaNotificationService.js
// خدمة إشعارات الموبايل الأصلية (PWA & Mobile OS Native Notifications) بأيقونة التطبيق الرسمية وشارة الأيقونة (App Badge)

import { TENANT_CONFIG, getAppEdition, getPwaIconUrl, getNotificationTitle, getScopedStorageKey } from './tenantConfig';
import { LocalNotifications } from '@capacitor/local-notifications';

const DELIVERED_STORAGE_KEY = getScopedStorageKey('delivered_notif_ids_v1');
const READ_STORAGE_KEY = getScopedStorageKey('read_notif_ids_v1');
const MAX_STORED_IDS = 250;

/**
 * قراءة قائمة بصمات الإشعارات التي تم إرسالها للهاتف مسبقاً لمنع التكرار المزعج
 */
export function getDeliveredNotificationIds() {
    if (typeof window === 'undefined') return new Set();
    try {
        const raw = localStorage.getItem(DELIVERED_STORAGE_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(arr) ? arr : []);
    } catch (_e) {
        return new Set();
    }
}

/**
 * تسجيل بصمة الإشعار كـ "تم إرساله للهاتف"
 */
export function markNotificationDelivered(fingerprint) {
    if (!fingerprint || typeof window === 'undefined') return;
    try {
        const currentSet = getDeliveredNotificationIds();
        currentSet.add(String(fingerprint));
        const arr = Array.from(currentSet).slice(-MAX_STORED_IDS);
        localStorage.setItem(DELIVERED_STORAGE_KEY, JSON.stringify(arr));
    } catch (_e) {}
}

/**
 * التحقق مما إذا كان الإشعار قد أُرسل للهاتف من قبل
 */
export function hasDeliveredNotification(fingerprint) {
    if (!fingerprint) return false;
    return getDeliveredNotificationIds().has(String(fingerprint));
}

/**
 * إدارة حالة القراءة (Read / Unread) للإشعارات داخل مركز الإشعارات
 */
export function getReadNotificationIds() {
    if (typeof window === 'undefined') return new Set();
    try {
        const raw = localStorage.getItem(READ_STORAGE_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(arr) ? arr : []);
    } catch (_e) {
        return new Set();
    }
}

export function markNotificationsAsRead(ids = []) {
    if (typeof window === 'undefined') return new Set();
    try {
        const currentSet = getReadNotificationIds();
        for (const id of ids) {
            if (id) currentSet.add(String(id));
        }
        const arr = Array.from(currentSet).slice(-MAX_STORED_IDS);
        localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(arr));
        return new Set(arr);
    } catch (_e) {
        return new Set();
    }
}

/**
 * تحديث شارة أيقونة التطبيق على شاشة الموبايل (App Icon Badge) وعنوان المتصفح
 * @param {number} count عدد الإشعارات غير المقروءة أو العاجلة
 */
export function updateAppIconBadgeCount(count = 0) {
    if (typeof window === 'undefined') return;
    const safeCount = Math.max(0, Number(count) || 0);

    // 1. Web Badging API (أيقونة البرنامج على شاشة الموبايل الرئيسية)
    try {
        if (typeof navigator !== 'undefined') {
            if (safeCount > 0 && 'setAppBadge' in navigator) {
                navigator.setAppBadge(safeCount).catch(() => {});
            } else if (safeCount === 0 && 'clearAppBadge' in navigator) {
                navigator.clearAppBadge().catch(() => {});
            }
        }
    } catch (_e) {}

    // 2. تحديث عنوان الصفحة (Document Title)
    try {
        const baseTitle = TENANT_CONFIG.churchName;
        if (safeCount > 0) {
            document.title = `(${safeCount} إشعار) ${baseTitle}`;
        } else {
            document.title = baseTitle;
        }
    } catch (_e) {}
}

/**
 * إطلاق إشعار حقيقي على نظام تشغيل الموبايل (Android / iOS PWA / Desktop) بأيقونة البرنامج الرسمية
 * @param {object} params
 * @param {string} params.title عنوان الإشعار
 * @param {string} params.body نص الإشعار التفصيلي
 * @param {string} [params.tag] معرف الإشعار
 * @param {string} [params.url] الرابط عند الضغط على الإشعار
 * @param {boolean} [params.urgent] هل الإشعار عاجل (اهتزاز أقوى)
 * @param {string} [params.fingerprint] بصمة منع التكرار (إذا لم يكن force=true)
 * @param {boolean} [params.force] إجبار الإرسال الفوري حتى لو أُرسل سابقاً (مثل زر التجربة)
 */
export async function dispatchNativeAppNotification({
    title,
    body,
    tag,
    url = '/#/',
    urgent = false,
    fingerprint = null,
    force = false,
    image = undefined,
    iconOverride = ''
}) {
    if (typeof window === 'undefined') return false;

    const dedupeKey = fingerprint || tag;
    if (!force && dedupeKey && hasDeliveredNotification(dedupeKey)) {
        return false;
    }

    const rawIcon = iconOverride || getPwaIconUrl();
    const iconUrl = rawIcon.startsWith('http') || rawIcon.startsWith('data:')
        ? rawIcon
        : `${window.location.origin}${rawIcon.startsWith('/') ? '' : '/'}${rawIcon}`;
    const notificationOptions = {
        body: body || '',
        icon: iconUrl,
        badge: iconUrl,
        ...(image ? { image } : {}),
        dir: 'rtl',
        lang: 'ar',
        vibrate: urgent ? [300, 100, 300, 100, 400] : [200, 100, 200],
        tag: tag || 'church-notification-' + Date.now(),
        renotify: true,
        requireInteraction: Boolean(urgent),
        data: { url: url || '/#/' }
    };

    let dispatched = false;

    // 1. المحاولة عبر Service Worker الرسمي للـ PWA (الأفضل لأجهزة الموبايل أندرويد و iOS)
    try {
        if ('Notification' in window && Notification.permission === 'granted') {
            if (navigator.serviceWorker && 'ready' in navigator.serviceWorker) {
                const registration = await Promise.race([
                    navigator.serviceWorker.ready,
                    new Promise((_, reject) => setTimeout(() => reject(new Error('SW timeout')), 2500))
                ]);
                if (registration && typeof registration.showNotification === 'function') {
                    await registration.showNotification(title, notificationOptions);
                    dispatched = true;
                }
            }

            // 2. Fallback إلى واجهة Notification المباشرة إذا لم يكن الـ SW جاهزاً
            if (!dispatched) {
                const n = new Notification(title, notificationOptions);
                n.onclick = () => {
                    try {
                        window.focus();
                        if (url) window.location.hash = url.replace(/^\/#/, '');
                    } catch (_e) {}
                };
                dispatched = true;
            }
        }
    } catch (_err) {
        // Fallback إضافي
        try {
            if ('Notification' in window && Notification.permission === 'granted') {
                new Notification(title, notificationOptions);
                dispatched = true;
            }
        } catch (_e2) {}
    }

    // 3. Fallback عبر Capacitor LocalNotifications إن كان التطبيق يعمل داخل حاوية Capacitor
    if (!dispatched) {
        try {
            await LocalNotifications.schedule({
                notifications: [
                    {
                        title,
                        body: body || '',
                        id: Math.floor(Math.random() * 100000) + 1,
                        schedule: { at: new Date(Date.now() + 300) }
                    }
                ]
            });
            dispatched = true;
        } catch (_capErr) {}
    }

    if (dispatched && dedupeKey) {
        markNotificationDelivered(dedupeKey);
    }

    return dispatched;
}

/**
 * طلب صلاحية إشعارات الموبايل بضغطة واحدة وإرسال إشعار ترحيبي بأيقونة البرنامج
 */
export async function requestAppNotificationPermission() {
    if (typeof window === 'undefined' || !('Notification' in window)) {
        try {
            const perm = await LocalNotifications.requestPermissions();
            return perm?.display === 'granted' ? 'granted' : 'denied';
        } catch (_e) {
            return 'unsupported';
        }
    }

    try {
        const result = await Notification.requestPermission();
        if (result === 'granted') {
            await dispatchNativeAppNotification({
                title: 'تم تفعيل إشعارات الخدمة بنجاح!',
                body: 'ستصلك إشعارات الحضور والافتقاد وتنبيهات مرحلتك مباشرة على الموبايل بأيقونة البرنامج.',
                tag: 'church-notif-welcome',
                force: true
            });
        }
        return result;
    } catch (_err) {
        return 'denied';
    }
}

/**
 * إرسال إشعار تجريبي فوري على الموبايل حسب دور الخادم الحالي لاختبار ظهور أيقونة البرنامج
 */
export async function sendTestMobileNotification(scope, summaryText = '') {
    if (typeof window === 'undefined') return false;

    if ('Notification' in window && Notification.permission !== 'granted') {
        const perm = await requestAppNotificationPermission();
        if (perm !== 'granted') {
            alert('يرجى السماح بالإشعارات من إعدادات المتصفح/الموبايل لتجربة الإشعار.');
            return false;
        }
    }

    const roleLabel = scope?.tierLabel || 'خادم الخدمة';
    const bodyText = summaryText || `تجربة ناجحة! نطاق إشعاراتك الحالي: ${roleLabel}`;

    return dispatchNativeAppNotification({
        title: getNotificationTitle(scope?.roleTitle || TENANT_CONFIG.churchShortName),
        body: bodyText,
        tag: 'church-test-notif-' + Date.now(),
        urgent: true,
        force: true
    });
}

/**
 * تجهيز حمولة إشعار النظام للرسائل الواردة الجديدة مع أيقونة النسخة النشطة (admin | servant | parent)
 */
export function buildIncomingMessageNotificationPayload(message = {}, editionConfig = null) {
    const editionId = String(editionConfig?.id || getAppEdition() || 'all').trim().toLowerCase();
    const iconPath = ['admin', 'servant', 'parent'].includes(editionId)
        ? `/editions/${editionId}/pwa-192x192.png`
        : getPwaIconUrl();
    const senderLabel = String(message.senderName || 'إدارة الخدمة').trim();
    const textPreview = String(message.body || '').trim().slice(0, 160);
    const body = textPreview
        ? `${senderLabel}: ${textPreview}`
        : `رسالة جديدة من ${senderLabel}${message.targetLabel ? ` (${message.targetLabel})` : ''}`;

    const rawImage = String(message.imageUrl || '').trim();
    const validImage = rawImage && (/^https?:\/\//i.test(rawImage) || rawImage.startsWith('/'))
        ? rawImage
        : undefined;

    return {
        title: String(message.title || 'رسالة جديدة من الخدمة').trim(),
        options: {
            body,
            icon: iconPath,
            badge: iconPath,
            image: validImage,
            vibrate: [200, 100, 200],
            tag: `msg_${message.id || Date.now()}`,
            renotify: true,
            url: message.targetType === 'children' && editionId === 'parent' ? '/#/parent-dashboard' : '/#/'
        }
    };
}

/**
 * إطلاق إشعار فوري على الموبايل/المتصفح عند وصول رسالة جديدة من Firestore
 */
export async function triggerIncomingMessageNotification(message = {}, editionConfig = null) {
    if (!message || !message.id) return false;
    const { title, options } = buildIncomingMessageNotificationPayload(message, editionConfig);
    return dispatchNativeAppNotification({
        title,
        body: options.body,
        tag: options.tag,
        url: options.url,
        image: options.image,
        iconOverride: options.icon,
        urgent: false,
        fingerprint: options.tag,
        force: false
    });
}
