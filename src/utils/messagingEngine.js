// src/utils/messagingEngine.js
// محرك مركز الرسائل والإعلانات متعددة الوسائط والتزامن اللحظي عبر Firestore وواتساب

import { collection, collectionGroup, doc, getDoc, getDocs, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../db/database.js';
import { dispatchNativeAppNotification, triggerIncomingMessageNotification } from './pwaNotificationService.js';
import { inferStageFromClass } from './notificationScopeEngine.js';
import { getScopedStorageKey } from './tenantConfig.js';

export const MESSAGE_DEFAULT_LINK_LABEL = 'فتح الرابط المرفق';

const TOMBSTONES_STORAGE_KEY = getScopedStorageKey('deleted_messages_tombstones_v1');
const NOTIFIED_IDS_STORAGE_KEY = getScopedStorageKey('notified_message_ids_v1');
const memoryTombstones = {};
const memoryNotifiedIds = new Set();
let hasPurgedLegacyDemoInSession = false;

export const CLIENT_DEVICE_SENDER_ID = (() => {
    const key = getScopedStorageKey('msg_client_device_id');
    try {
        if (typeof window !== 'undefined' && window.sessionStorage) {
            const existing = window.sessionStorage.getItem(key);
            if (existing) return existing;
            const created = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            window.sessionStorage.setItem(key, created);
            return created;
        }
    } catch (_e) {}
    return `dev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
})();

export function getNotifiedMessageIds() {
    const set = new Set(memoryNotifiedIds);
    if (typeof window !== 'undefined' && window.localStorage) {
        try {
            const parsed = JSON.parse(window.localStorage.getItem(NOTIFIED_IDS_STORAGE_KEY) || '[]');
            if (Array.isArray(parsed)) {
                parsed.forEach(id => {
                    if (id) set.add(String(id).trim());
                });
            }
        } catch (_e) {}
    }
    return set;
}

export function markMessagesAsNotified(ids = []) {
    const list = Array.isArray(ids) ? ids : [ids];
    const cleanList = list.map(id => String(id || '').trim()).filter(Boolean);
    if (cleanList.length === 0) return;

    const current = getNotifiedMessageIds();
    cleanList.forEach((id) => {
        memoryNotifiedIds.add(id);
        current.add(id);
    });
    if (typeof window !== 'undefined' && window.localStorage) {
        try {
            window.localStorage.setItem(NOTIFIED_IDS_STORAGE_KEY, JSON.stringify(Array.from(current).slice(-300)));
        } catch (_e) {}
    }
}

export function shouldNotifyForIncomingMessage(msg, {
    nowMs = Date.now(),
    seenIds = null,
    currentDeviceId = CLIENT_DEVICE_SENDER_ID,
    skipInitial = false
} = {}) {
    if (!msg || !msg.id || msg.isDeleted === true) return false;
    const cleanId = String(msg.id).trim();
    if (skipInitial || !cleanId || isMessageTombstoned(cleanId) || isDemoOrFakeMessage(msg)) return false;
    if (currentDeviceId && msg.senderDeviceId && String(msg.senderDeviceId).trim() === String(currentDeviceId).trim()) {
        return false;
    }
    const seen = seenIds instanceof Set ? seenIds : getNotifiedMessageIds();
    if (seen.has(cleanId)) return false;

    const createdMs = typeof msg.createdAt === 'number'
        ? msg.createdAt
        : Date.parse(msg.createdAt || '');
    if (Number.isFinite(createdMs) && createdMs > 0) {
        if (nowMs - createdMs > 10 * 60 * 1000) return false;
    }
    return true;
}

function readTombstonesSafe() {
    const merged = { ...memoryTombstones };
    if (typeof window !== 'undefined' && window.localStorage) {
        try {
            const parsed = JSON.parse(window.localStorage.getItem(TOMBSTONES_STORAGE_KEY) || '{}');
            if (parsed && typeof parsed === 'object') {
                Object.assign(merged, parsed);
            }
        } catch (_e) {
            // Ignore malformed JSON
        }
    }
    return merged;
}

export function getDeletedMessageTombstones() {
    return readTombstonesSafe();
}

export function isMessageTombstoned(msgId) {
    if (!msgId) return false;
    const map = readTombstonesSafe();
    return Boolean(map[String(msgId).trim()]);
}

export function markMessageTombstone(msgId, deletedAtMs = Date.now()) {
    const cleanId = String(msgId || '').trim();
    if (!cleanId) return;
    memoryTombstones[cleanId] = Number(deletedAtMs) || Date.now();
    if (typeof window !== 'undefined' && window.localStorage) {
        try {
            const current = readTombstonesSafe();
            current[cleanId] = memoryTombstones[cleanId];
            window.localStorage.setItem(TOMBSTONES_STORAGE_KEY, JSON.stringify(current));
        } catch (_e) {
            // Ignore storage quota issues
        }
    }
}

export function isDemoOrFakeMessage(msg = {}) {
    if (!msg) return false;
    const id = String(msg.id || '').trim();
    return Boolean(msg.isSeededDemo === true || /^msg_demo_/i.test(id));
}

export async function purgeLegacyDemoMessages(force = false) {
    if (hasPurgedLegacyDemoInSession && !force) return 0;
    hasPurgedLegacyDemoInSession = true;
    if (!db?.messages) return 0;

    try {
        const all = await db.messages.toArray();
        const idsToDelete = all
            .filter((m) => !m || !m.id || m.isDeleted === true || isDemoOrFakeMessage(m) || isMessageTombstoned(m.id))
            .map((m) => m.id);
        if (idsToDelete.length > 0) {
            await db.messages.bulkDelete(idsToDelete);
        }
        return idsToDelete.length;
    } catch (_e) {
        return 0;
    }
}

function normalizeOptionalHttpUrl(rawUrl = '') {
    const clean = String(rawUrl || '').trim();
    if (!clean) return '';
    if (/^https?:\/\//i.test(clean)) return clean;
    if (/^(javascript|data|vbscript):/i.test(clean)) return '';
    return `https://${clean}`;
}

/**
 * استخراج رابط التضمين المباشر للفيديو (YouTube / Facebook / Google Drive / Vimeo / MP4)
 */
export function parseVideoEmbedUrl(rawUrl = '') {
    const url = String(rawUrl || '').trim();
    if (!url) return { type: 'none', embedUrl: '', rawUrl: '' };

    try {
        // 1. YouTube (watch?v=, youtu.be/, shorts/, live/)
        const ytWatch = url.match(/(?:youtube\.com\/(?:watch\?.*?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/);
        if (ytWatch && ytWatch[1]) {
            return {
                type: 'iframe',
                provider: 'youtube',
                embedUrl: `https://www.youtube.com/embed/${ytWatch[1]}?rel=0`,
                rawUrl: url
            };
        }

        // 2. Vimeo
        const vimeoMatch = url.match(/vimeo\.com\/(?:video\/)?(\d{5,})/);
        if (vimeoMatch && vimeoMatch[1]) {
            return {
                type: 'iframe',
                provider: 'vimeo',
                embedUrl: `https://player.vimeo.com/video/${vimeoMatch[1]}`,
                rawUrl: url
            };
        }

        // 3. Google Drive
        const driveMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
        if (driveMatch && driveMatch[1]) {
            return {
                type: 'iframe',
                provider: 'drive',
                embedUrl: `https://drive.google.com/file/d/${driveMatch[1]}/preview`,
                rawUrl: url
            };
        }

        // 4. Facebook video plugin embed
        if (/facebook\.com\/.*\/videos\/|fb\.watch\//i.test(url)) {
            return {
                type: 'iframe',
                provider: 'facebook',
                embedUrl: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=false&width=560`,
                rawUrl: url
            };
        }

        // 5. Direct MP4 / WebM / MOV / Cloudinary /video/upload
        if (/\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url) || url.includes('/video/upload/') || url.startsWith('data:video/')) {
            return {
                type: 'video',
                provider: 'direct',
                embedUrl: url,
                rawUrl: url
            };
        }
    } catch (_e) {
        // fallback to link
    }

    return { type: 'link', provider: 'external', embedUrl: url, rawUrl: url };
}

/**
 * تنسيق رقم الموبايل المصري لرابط واتساب الرسمي
 */
export function normalizeEgyptPhoneForWhatsapp(phone = '') {
    let clean = String(phone || '').replace(/\D/g, '');
    if (!clean) return '';
    if (clean.startsWith('00')) clean = clean.slice(2);
    if (clean.startsWith('0')) clean = '2' + clean;
    else if (!clean.startsWith('20') && clean.length >= 9 && clean.length <= 10) clean = '20' + clean;
    return clean;
}

/**
 * تنسيق نص رسالة الواتساب متضمناً اسم المستلم والنص والوسائط والرابط (بدون إيموجي)
 */
export function formatBroadcastWhatsappText(message = {}, recipientName = '') {
    const lines = [];
    if (recipientName) {
        lines.push(`سلام ونعمة يا ${recipientName}،`);
    }
    if (message.title) {
        lines.push(`*${String(message.title).trim()}*`);
    }
    if (message.body) {
        lines.push(String(message.body).trim());
    }
    if (message.imageUrl && /^https?:\/\//i.test(message.imageUrl)) {
        lines.push(`صورة مرفقة: ${message.imageUrl}`);
    }
    if (message.videoUrl) {
        lines.push(`فيديو مرفق: ${message.videoUrl}`);
    }
    if (message.linkUrl) {
        const label = String(message.linkLabel || message.linkTitle || MESSAGE_DEFAULT_LINK_LABEL).trim();
        lines.push(`${label}: ${message.linkUrl}`);
    }
    if (message.targetLabel) {
        lines.push(`— ${message.targetLabel}`);
    }
    return lines.filter(Boolean).join('\n\n');
}

export function buildWhatsappDirectLink(phone, text) {
    const cleanPhone = normalizeEgyptPhoneForWhatsapp(phone);
    if (!cleanPhone) {
        return `https://api.whatsapp.com/send?text=${encodeURIComponent(text || '')}`;
    }
    return `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(text || '')}`;
}

/**
 * استخراج قائمة خيارات الجمهور المستهدف بناءً على الصلاحية الهرمية (4 مستويات)
 */
export function getAudienceScopeOptions(accessScope = {}, activeOsraName = '') {
    if (!accessScope || accessScope.isParent || accessScope.isGuest) return [];

    if (accessScope.isSuperAdmin && !accessScope.isImpersonating) {
        return [
            {
                id: 'all_servants',
                targetType: 'servants',
                scopeKind: 'all_servants',
                label: 'كل خدام الكنيسة (جميع المراحل والأسر)',
                needsStage: false,
                needsClass: false
            },
            {
                id: 'stage_servants',
                targetType: 'servants',
                scopeKind: 'stage_servants',
                label: 'خدام مرحلة محددة',
                needsStage: true,
                needsClass: false
            },
            {
                id: 'class_servants',
                targetType: 'servants',
                scopeKind: 'class_servants',
                label: 'خدام أسرة / فصل محدد',
                needsStage: false,
                needsClass: true
            },
            {
                id: 'all_children',
                targetType: 'children',
                scopeKind: 'all_children',
                label: 'كل مخدومي الكنيسة وأولياء الأمور',
                needsStage: false,
                needsClass: false
            },
            {
                id: 'stage_children',
                targetType: 'children',
                scopeKind: 'stage_children',
                label: 'مخدومي مرحلة محددة وأولياء أمورهم',
                needsStage: true,
                needsClass: false
            },
            {
                id: 'class_children',
                targetType: 'children',
                scopeKind: 'class_children',
                label: 'مخدومي خدمة أو أسرة محددة',
                needsStage: false,
                needsClass: true
            }
        ];
    }

    if (accessScope.isStageLeader && !accessScope.isImpersonating) {
        const stName = accessScope.stageName || 'المرحلة';
        return [
            {
                id: 'stage_servants',
                targetType: 'servants',
                scopeKind: 'stage_servants',
                fixedStage: stName,
                label: `خدام المرحلة (${stName})`,
                needsStage: false,
                needsClass: false
            },
            {
                id: 'class_servants',
                targetType: 'servants',
                scopeKind: 'class_servants',
                label: 'خدام فصل محدد داخل المرحلة',
                needsStage: false,
                needsClass: true
            },
            {
                id: 'stage_children',
                targetType: 'children',
                scopeKind: 'stage_children',
                fixedStage: stName,
                label: `مخدومي المرحلة (${stName}) وأولياء الأمور`,
                needsStage: false,
                needsClass: false
            },
            {
                id: 'class_children',
                targetType: 'children',
                scopeKind: 'class_children',
                label: 'مخدومي فصل محدد داخل المرحلة',
                needsStage: false,
                needsClass: true
            }
        ];
    }

    const activeKey = accessScope.activeSyncKey || '';
    const classTitle = activeOsraName || accessScope.primaryClassName || activeKey || 'الفصل';
    return [
        {
            id: 'class_children',
            targetType: 'children',
            scopeKind: 'class_children',
            fixedSyncKey: activeKey,
            label: `مخدومي وأولياء أمور فصل: ${classTitle}`,
            needsStage: false,
            needsClass: false
        }
    ];
}

/**
 * استخراج قائمة المستلمين الفعليين (أبناء الفصل أو الخدام + مسؤولي الأسر في الهيكل) للإرسال الفردي عبر الواتساب
 */
export function resolveTargetRecipients({
    targetType = 'children',
    scopeKind = 'class_children',
    targetSyncKey = '',
    targetStage = '',
    allOsras = [],
    children = [],
    servants = [],
    services = []
}) {
    const cleanTargetKey = String(targetSyncKey || '').trim();
    const cleanTargetStage = String(targetStage || '').trim();

    const allowedStageSyncKeys = new Set(
        (allOsras || [])
            .filter(o => {
                if (!cleanTargetStage) return true;
                const osraStage = o.stageName || inferStageFromClass(o);
                return osraStage === cleanTargetStage;
            })
            .map(o => String(o.syncKey || '').trim())
            .filter(Boolean)
    );

    if (targetType === 'servants') {
        const structureLeaders = [];
        (services || []).forEach((srv, sIdx) => {
            const stName = String(srv?.name || srv?.stageName || '').trim();
            const srvPhone = String(srv?.leaderPhone || srv?.adminPhone || '').trim();
            if (srvPhone) {
                structureLeaders.push({
                    id: `srv_leader_${sIdx}`,
                    name: srv.leaderName || `أمين ${stName || 'الخدمة'}`,
                    phone: srvPhone,
                    stageName: stName,
                    syncKey: '',
                    role: srv.leaderRole || 'أمين مرحلة',
                    assignedOsra: stName
                });
            }
            (srv?.osras || []).forEach((osra, oIdx) => {
                const oKey = String(osra?.syncKey || '').trim();
                const oPhone = String(osra?.leaderPhone || osra?.servantPhone || osra?.phone || '').trim();
                if (oPhone) {
                    structureLeaders.push({
                        id: `osra_leader_${sIdx}_${oIdx}`,
                        name: osra.leaderName || osra.servantName || `مسؤول ${osra.name || oKey}`,
                        phone: oPhone,
                        stageName: osra.stageName || stName,
                        syncKey: oKey,
                        role: 'مسؤول أسرة',
                        assignedOsra: osra.name || oKey
                    });
                }
            });
        });

        const combinedServants = [...(servants || []), ...structureLeaders];
        const filtered = combinedServants.filter((s) => {
            if (!s || !s.phone) return false;
            if (scopeKind === 'all_servants') return true;
            const sKey = String(s.syncKey || '').trim();
            if (scopeKind === 'class_servants') {
                return sKey === cleanTargetKey;
            }
            if (scopeKind === 'stage_servants') {
                return s.stageName === cleanTargetStage || (sKey && allowedStageSyncKeys.has(sKey));
            }
            return true;
        });

        const seenPhones = new Set();
        return filtered
            .map((s) => {
                const phone = String(s.phone || '').trim();
                const norm = normalizeEgyptPhoneForWhatsapp(phone);
                if (!norm || seenPhones.has(norm)) return null;
                seenPhones.add(norm);
                return {
                    id: s.id || norm,
                    name: s.name || 'خادم',
                    subtitle: s.assignedOsra || s.osraName || s.role || s.syncKey || '',
                    phone
                };
            })
            .filter(Boolean);
    }

    const activeKids = (children || []).filter((c) => {
        if (!c || c.isDeleted) return false;
        const cKey = String(c.syncKey || '').trim();
        if (scopeKind === 'all_children') return true;
        if (scopeKind === 'class_children') return cKey === cleanTargetKey;
        if (scopeKind === 'stage_children') return allowedStageSyncKeys.has(cKey);
        return cKey === cleanTargetKey;
    });

    return activeKids.map((c) => {
        const primaryPhone =
            (c.whatsappTarget === 'child' && c.childPhone) ||
            (c.whatsappTarget === 'father' && c.fatherPhone) ||
            (c.whatsappTarget === 'mother' && c.motherPhone) ||
            c.whatsapp ||
            c.childPhone ||
            c.motherPhone ||
            c.fatherPhone ||
            c.phone ||
            '';
        return {
            id: c.id,
            name: c.name || 'مخدوم',
            subtitle: c.osraName || c.syncKey || '',
            phone: String(primaryPhone || '').trim()
        };
    }).filter((r) => Boolean(r.phone));
}

export function isMessageVisibleToServant(msg, accessScope = {}, currentServant = {}) {
    if (!msg || msg.isDeleted || isMessageTombstoned(msg.id) || isDemoOrFakeMessage(msg)) return false;
    if (msg.targetType !== 'servants') return false;
    if (msg.scopeKind === 'all_servants') return true;

    const myKeys = new Set([
        ...(accessScope.allowedSyncKeys || []),
        accessScope.activeSyncKey,
        currentServant?.syncKey
    ].map(k => String(k || '').trim()).filter(Boolean));

    const myStages = new Set([
        accessScope.stageName,
        currentServant?.stageName,
        ...(accessScope.allowedOsras || []).map(o => o.stageName)
    ].map(s => String(s || '').trim()).filter(Boolean));

    if (accessScope.isSuperAdmin && !accessScope.isImpersonating) return true;
    const msgStage = String(msg.targetStage || msg.stageName || '').trim();
    if (msg.scopeKind === 'stage_servants' && msgStage) {
        return myStages.has(msgStage);
    }
    if (msg.targetSyncKey && myKeys.has(String(msg.targetSyncKey).trim())) {
        return true;
    }
    if (msg.syncKey && myKeys.has(String(msg.syncKey).trim())) {
        return true;
    }
    return false;
}

export function isMessageVisibleToChild(msg, childSyncKey = '', allOsras = []) {
    if (!msg || msg.isDeleted || isMessageTombstoned(msg.id) || isDemoOrFakeMessage(msg)) return false;
    if (msg.targetType !== 'children') return false;
    if (msg.scopeKind === 'all_children') return true;

    const cleanChildKey = String(childSyncKey || '').trim();
    if (!cleanChildKey) return false;

    const msgKey = String(msg.targetSyncKey || msg.syncKey || '').trim();
    if (msg.scopeKind === 'class_children' || (!msg.scopeKind && msgKey && msgKey !== 'ALL')) {
        return msgKey === cleanChildKey;
    }
    const msgStage = String(msg.targetStage || msg.stageName || '').trim();
    if (msg.scopeKind === 'stage_children' && msgStage) {
        const osraMatch = (allOsras || []).find(o => String(o.syncKey || '').trim() === cleanChildKey);
        const childStage = osraMatch?.stageName || inferStageFromClass(osraMatch || cleanChildKey);
        return String(childStage || '').trim() === msgStage;
    }
    return false;
}

/**
 * تحديد صلاحية الظهور في شاشة الرئيسية للخدام والقيادة (الواردة من أمين الخدمة + المرسلة لمخدومي الفصل)
 */
export function isMessageVisibleInHomeHub(msg, accessScope = {}, currentServant = {}, allOsras = []) {
    if (!msg || msg.isDeleted || isMessageTombstoned(msg.id) || isDemoOrFakeMessage(msg)) return false;
    if (accessScope.isSuperAdmin && !accessScope.isImpersonating) return true;

    if (msg.targetType === 'servants') {
        return isMessageVisibleToServant(msg, accessScope, currentServant);
    }

    if (msg.targetType === 'children') {
        if (accessScope.isStageLeader && !accessScope.isImpersonating) {
            if (msg.scopeKind === 'all_children') return true;
            const msgStage = String(msg.targetStage || msg.stageName || '').trim();
            if (msgStage && msgStage === String(accessScope.stageName || '').trim()) return true;
            const msgKey = String(msg.targetSyncKey || msg.syncKey || '').trim();
            if (msgKey && (accessScope.allowedSyncKeys || []).includes(msgKey)) return true;
            return false;
        }
        const activeKey = String(accessScope.activeSyncKey || currentServant?.syncKey || '').trim();
        return isMessageVisibleToChild(msg, activeKey, allOsras);
    }

    return false;
}

export function canCurrentUserDeleteMessage(msg, accessScope = {}, currentServant = {}) {
    if (!msg || accessScope.isParent || accessScope.isGuest) return false;
    if (accessScope.isSuperAdmin && !accessScope.isImpersonating) return true;

    const myName = String(currentServant?.name || '').trim();
    if (myName && String(msg.senderName || '').trim() === myName) return true;

    if (accessScope.isStageLeader && !accessScope.isImpersonating) {
        const msgStage = String(msg.targetStage || msg.stageName || '').trim();
        const msgKey = String(msg.targetSyncKey || msg.syncKey || '').trim();
        if (msgStage && msgStage === String(accessScope.stageName || '').trim()) return true;
        if (msgKey && (accessScope.allowedSyncKeys || []).includes(msgKey)) return true;
        return false;
    }

    const activeKey = String(accessScope.activeSyncKey || currentServant?.syncKey || '').trim();
    const msgKey = String(msg.targetSyncKey || msg.syncKey || '').trim();
    return Boolean(
        activeKey &&
        msg.targetType === 'children' &&
        msg.scopeKind !== 'all_children' &&
        msg.scopeKind !== 'stage_children' &&
        msgKey === activeKey
    );
}

/**
 * حفظ وبث رسالة متعددة الوسائط محلياً (Dexie) ولحظياً إلى Firestore (مع إطلاق إشعار فوري للموبايل)
 */
export async function saveAndBroadcastMessage(rawInput = {}, options = {}) {
    const nowIso = new Date().toISOString();
    const msgId = rawInput.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const scopeKind = rawInput.scopeKind || rawInput.targetScope || (rawInput.targetType === 'servants' ? 'all_servants' : 'class_children');
    const cleanTargetSyncKey = String(rawInput.targetSyncKey || rawInput.syncKey || '').trim();
    const effectiveSyncKey = (cleanTargetSyncKey && !['ALL', 'MASTER_ACCESS', 'ADMIN_MODE', 'STAGE_ADMIN'].includes(cleanTargetSyncKey))
        ? cleanTargetSyncKey
        : 'ALL';
    const cleanStage = String(rawInput.targetStage || rawInput.stageName || '').trim();
    const normalizedVideo = normalizeOptionalHttpUrl(rawInput.videoUrl || '');
    const normalizedLink = normalizeOptionalHttpUrl(rawInput.linkUrl || '');
    const cleanLinkLabel = String(rawInput.linkLabel || rawInput.linkTitle || MESSAGE_DEFAULT_LINK_LABEL).trim();

    const record = {
        id: msgId,
        syncKey: effectiveSyncKey,
        targetType: rawInput.targetType === 'servants' ? 'servants' : 'children',
        scopeKind,
        targetScope: scopeKind,
        targetSyncKey: effectiveSyncKey,
        targetStage: cleanStage,
        stageName: cleanStage,
        targetLabel: String(rawInput.targetLabel || 'رسالة الكنيسة').trim(),
        title: String(rawInput.title || 'رسالة جديدة من الخدمة').trim(),
        body: String(rawInput.body || '').trim(),
        imageUrl: String(rawInput.imageUrl || '').trim(),
        videoUrl: normalizedVideo,
        linkUrl: normalizedLink,
        linkLabel: cleanLinkLabel,
        linkTitle: cleanLinkLabel,
        senderName: String(rawInput.senderName || 'أمين الخدمة').trim(),
        senderRole: String(rawInput.senderRole || '').trim(),
        senderPhone: String(rawInput.senderPhone || '').trim(),
        senderDeviceId: String(rawInput.senderDeviceId || CLIENT_DEVICE_SENDER_ID).trim(),
        createdAt: rawInput.createdAt || nowIso,
        updatedAt: nowIso,
        isDirty: true,
        isDeleted: false
    };

    markMessagesAsNotified([msgId]);

    if (db?.messages) {
        await db.messages.put(record);
    }

    let cloudSynced = false;
    let cloudError = '';
    const fs = options.firestore;
    const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
    if (fs && isOnline) {
        try {
            const cloudPayload = {
                id: record.id,
                syncKey: record.syncKey,
                targetType: record.targetType,
                scopeKind: record.scopeKind,
                targetScope: record.targetScope,
                targetSyncKey: record.targetSyncKey,
                targetStage: record.targetStage,
                stageName: record.stageName,
                targetLabel: record.targetLabel,
                title: record.title,
                body: record.body,
                imageUrl: record.imageUrl,
                videoUrl: record.videoUrl,
                linkUrl: record.linkUrl,
                linkLabel: record.linkLabel,
                linkTitle: record.linkTitle,
                senderName: record.senderName,
                senderRole: record.senderRole,
                senderPhone: record.senderPhone,
                senderDeviceId: record.senderDeviceId,
                createdAt: record.createdAt,
                updatedAt: record.updatedAt,
                isDeleted: false
            };

            const isClassTargeted = effectiveSyncKey !== 'ALL' && (scopeKind === 'class_children' || scopeKind === 'class_servants');
            if (isClassTargeted) {
                await setDoc(doc(fs, 'Osras', effectiveSyncKey, 'messages', msgId), cloudPayload, { merge: true });
            } else {
                await setDoc(doc(fs, 'System', 'mainConfig', 'broadcastMessages', msgId), cloudPayload, { merge: true });
            }

            cloudSynced = true;
            if (db?.messages) {
                await db.messages.update(msgId, { isDirty: false });
            }
        } catch (err) {
            cloudError = err?.message || 'تعذر الاتصال بالسحابة';
            console.warn('[MessagingEngine] Cloud publish error:', cloudError);
        }
    }

    // Channel B: Native Mobile / Browser Notification
    try {
        await dispatchNativeAppNotification({
            title: record.title,
            body: record.body || `رسالة جديدة من ${record.senderName} (${record.targetLabel})`,
            tag: `msg_${msgId}`,
            url: record.targetType === 'children' ? '/#/parent-dashboard' : '/#/',
            urgent: false,
            fingerprint: `msg_${msgId}`,
            force: true
        });
    } catch (_e) {
        // Ignore notification errors in unsupported browsers
    }

    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('church-messages-updated', { detail: { ...record, cloudSynced } }));
    }

    return { ...record, cloudSynced, cloudError };
}

async function applyCloudMessagesBatch(docsList = [], deletedIdsList = []) {
    await purgeLegacyDemoMessages();

    const toDelete = new Set(deletedIdsList.map(id => String(id || '').trim()).filter(Boolean));
    const toPut = [];

    for (const raw of docsList) {
        if (!raw || !raw.id) continue;
        const cleanId = String(raw.id).trim();
        if (raw.isDeleted === true || isDemoOrFakeMessage(raw) || isMessageTombstoned(cleanId)) {
            markMessageTombstone(cleanId, Number(raw.deletedAt) || Date.now());
            toDelete.add(cleanId);
        } else {
            toPut.push({ ...raw, id: cleanId, isDeleted: false, isDirty: false });
        }
    }

    if (db?.messages) {
        if (toDelete.size > 0) {
            await db.messages.bulkDelete(Array.from(toDelete)).catch(() => {});
        }
        if (toPut.length > 0) {
            await db.messages.bulkPut(toPut).catch(() => {});
        }
    }

    return { putCount: toPut.length, deletedCount: toDelete.size };
}

/**
 * سحب الرسائل من السحابة وتطبيق Tombstones الحذف الدائم
 */
export async function pullMessagesFromCloud(firestore, options = {}) {
    await purgeLegacyDemoMessages();
    if (!firestore || (typeof navigator !== 'undefined' && !navigator.onLine)) return [];

    const pulled = [];
    const seen = new Set();
    const deletedIds = [];

    const ingestItem = (item) => {
        if (!item || !item.id || seen.has(item.id)) return;
        seen.add(item.id);
        if (item.isDeleted === true || isDemoOrFakeMessage(item) || isMessageTombstoned(item.id)) {
            deletedIds.push(item.id);
        } else {
            pulled.push(item);
        }
    };

    try {
        const broadcastColSnap = await getDocs(collection(firestore, 'System', 'mainConfig', 'broadcastMessages')).catch(() => null);
        broadcastColSnap?.forEach?.((d) => ingestItem({ id: d.id, ...d.data() }));
    } catch (_e) {
        // Ignore subcollection read errors
    }

    try {
        const legacyBroadcastSnap = await getDoc(doc(firestore, 'System', 'broadcastMessages')).catch(() => null);
        if (legacyBroadcastSnap?.exists?.()) {
            const items = Array.isArray(legacyBroadcastSnap.data()?.items) ? legacyBroadcastSnap.data().items : [];
            items.forEach(ingestItem);
        }
    } catch (_e) {
        // Ignore legacy pull errors
    }

    const syncKey = String(options.syncKey || '').trim();
    try {
        if (syncKey && !['MASTER_ACCESS', 'ADMIN_MODE', 'STAGE_ADMIN', 'ALL'].includes(syncKey)) {
            const classSnap = await getDocs(collection(firestore, 'Osras', syncKey, 'messages')).catch(() => null);
            classSnap?.forEach?.((d) => ingestItem({ id: d.id, ...d.data() }));
        } else if (options.pullAllGroups) {
            const grpSnap = await getDocs(collectionGroup(firestore, 'messages')).catch(() => null);
            grpSnap?.forEach?.((d) => ingestItem({ id: d.id, ...d.data() }));
        }
    } catch (_e) {
        // Ignore class pull errors
    }

    await applyCloudMessagesBatch([...pulled], deletedIds);
    return pulled;
}

/**
 * مستمع لحظي (Firestore onSnapshot) يربط تطبيق الإدارة والخادم وولي الأمر في أقل من ثانية
 */
export function subscribeToRealtimeMessages(firestore, options = {}) {
    void purgeLegacyDemoMessages();
    if (!firestore) return () => {};

    const unsubscribes = [];
    const syncKey = String(options.syncKey || '').trim();
    const hasSpecificClass = Boolean(syncKey && !['MASTER_ACCESS', 'ADMIN_MODE', 'STAGE_ADMIN', 'ALL'].includes(syncKey));

    const createSnapshotHandler = () => {
        let isInitialSnapshot = true;

        return (snap) => {
            if (!snap) return;
            const docsList = [];
            const deletedIds = [];
            const addedMessages = [];

            snap.docChanges().forEach((change) => {
                const id = change.doc?.id;
                const data = change.doc?.data ? change.doc.data() : {};
                if (change.type === 'removed' || data.isDeleted === true || isMessageTombstoned(id) || isDemoOrFakeMessage({ id, ...data })) {
                    if (id) deletedIds.push(id);
                } else {
                    const msgObj = { id, ...data };
                    docsList.push(msgObj);
                    if (change.type === 'added') addedMessages.push(msgObj);
                }
            });

            if (docsList.length === 0 && deletedIds.length === 0 && snap.docs) {
                snap.docs.forEach((d) => {
                    const data = d.data() || {};
                    if (data.isDeleted === true || isMessageTombstoned(d.id) || isDemoOrFakeMessage({ id: d.id, ...data })) {
                        deletedIds.push(d.id);
                    } else {
                        docsList.push({ id: d.id, ...data });
                    }
                });
            }

            if (isInitialSnapshot) {
                isInitialSnapshot = false;
                // Mark historical messages as seen on boot so old broadcasts never spam notifications
                markMessagesAsNotified(docsList.map(d => d.id));
            } else {
                const nowMs = Date.now();
                const seenIds = getNotifiedMessageIds();
                for (const incoming of addedMessages) {
                    const isRelevant = typeof options.isMessageRelevantToViewer === 'function'
                        ? Boolean(options.isMessageRelevantToViewer(incoming))
                        : true;
                    if (
                        isRelevant &&
                        shouldNotifyForIncomingMessage(incoming, {
                            nowMs,
                            seenIds,
                            currentDeviceId: CLIENT_DEVICE_SENDER_ID,
                            skipInitial: false
                        })
                    ) {
                        markMessagesAsNotified([incoming.id]);
                        seenIds.add(String(incoming.id).trim());
                        void triggerIncomingMessageNotification(incoming);
                        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
                            window.dispatchEvent(new CustomEvent('church-incoming-message-toast', { detail: { message: incoming } }));
                        }
                    }
                }
            }

            void applyCloudMessagesBatch(docsList, deletedIds);
        };
    };

    try {
        unsubscribes.push(
            onSnapshot(
                collection(firestore, 'System', 'mainConfig', 'broadcastMessages'),
                createSnapshotHandler(),
                (err) => console.warn('[MessagingEngine] broadcastMessages snapshot warning:', err?.message || err)
            )
        );
    } catch (_e) {
        // Ignore listener setup issue
    }

    if (hasSpecificClass) {
        try {
            unsubscribes.push(
                onSnapshot(
                    collection(firestore, 'Osras', syncKey, 'messages'),
                    createSnapshotHandler(),
                    (err) => console.warn('[MessagingEngine] class messages snapshot warning:', err?.message || err)
                )
            );
        } catch (_e) {
            // Ignore listener setup issue
        }
    } else if (options.listenAllGroups) {
        try {
            unsubscribes.push(
                onSnapshot(
                    collectionGroup(firestore, 'messages'),
                    createSnapshotHandler(),
                    (err) => console.warn('[MessagingEngine] collectionGroup messages snapshot warning:', err?.message || err)
                )
            );
        } catch (_e) {
            // Ignore listener setup issue
        }
    }

    // مزامنة أولية تنظف أي بقايا قديمة
    void pullMessagesFromCloud(firestore, { syncKey, pullAllGroups: Boolean(options.listenAllGroups) });

    return () => {
        unsubscribes.forEach((fn) => {
            try { fn(); } catch (_e) {}
        });
    };
}

/**
 * حذف دائم للرسالة محلياً وفي Firestore مع حفظ Tombstone لمنع عودتها إطلاقاً
 */
export async function deleteBroadcastMessage(msgId, syncKey = '', firestore = null, options = {}) {
    if (!msgId) return;
    const cleanId = String(msgId).trim();
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    markMessageTombstone(cleanId, nowMs);

    if (db?.messages) {
        await db.messages.delete(cleanId).catch(async () => {
            await db.messages.update(cleanId, { isDeleted: true, deletedAt: nowMs, updatedAt: nowIso, isDirty: false }).catch(() => {});
        });
    }

    const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
    if (firestore && isOnline) {
        const cleanKey = String(syncKey || '').trim();
        const tombstonePayload = {
            id: cleanId,
            isDeleted: true,
            deletedAt: nowMs,
            updatedAt: nowIso
        };

        const tasks = [];
        if (cleanKey && !['ALL', 'MASTER_ACCESS', 'ADMIN_MODE', 'STAGE_ADMIN'].includes(cleanKey)) {
            tasks.push(
                setDoc(doc(firestore, 'Osras', cleanKey, 'messages', cleanId), tombstonePayload, { merge: true }).catch(() => {})
            );
        }

        const scopeKind = String(options.scopeKind || '').trim();
        const isGlobalOrUnknown = !cleanKey || cleanKey === 'ALL' || ['all_servants', 'stage_servants', 'all_children', 'stage_children'].includes(scopeKind) || !scopeKind;
        if (isGlobalOrUnknown) {
            tasks.push(
                setDoc(doc(firestore, 'System', 'mainConfig', 'broadcastMessages', cleanId), tombstonePayload, { merge: true }).catch(() => {})
            );
        }

        tasks.push((async () => {
            try {
                const legacyRef = doc(firestore, 'System', 'broadcastMessages');
                const snap = await getDoc(legacyRef).catch(() => null);
                if (snap?.exists?.()) {
                    const items = Array.isArray(snap.data()?.items) ? snap.data().items : [];
                    const next = items.filter((it) => String(it?.id) !== cleanId);
                    if (next.length !== items.length) {
                        await setDoc(legacyRef, { items: next, updatedAt: nowIso }, { merge: true });
                    }
                }
            } catch (_e) {}
        })());

        await Promise.allSettled(tasks);
    }

    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('church-messages-deleted', { detail: { id: cleanId } }));
    }
}

export const softDeleteMessage = deleteBroadcastMessage;
