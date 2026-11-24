import { createSyncDeadline, SYNC_TIMEOUT_MS } from '../utils/syncDeadline';
import { readScopedStorage, writeScopedStorage } from '../utils/tenantConfig';
import { sanitizeAuthorizedServants, sanitizeChurchServices } from '../utils/churchStructureSanitizer';
import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { firestore } from '../db/firebase';
import {
    scopedSyncKeys,
    decodeCloudRecord,
    reconcileCloudChildrenBatch,
    reconcileCloudAttendanceBatch,
    syncScopedClassesFromCloud
} from '../db/childSync';

export default function useChildrenRealtimeSync() {
    const [scope, setScope] = useState(() => JSON.stringify(scopedSyncKeys().sort()));

    useEffect(() => {
        const refresh = () => setScope(JSON.stringify(scopedSyncKeys().sort()));
        const timer = setInterval(refresh, 2500);
        window.addEventListener('auth-changed', refresh);
        window.addEventListener('syncKey-changed', refresh);
        window.addEventListener('servant-profile-updated', refresh);
        window.addEventListener('storage', refresh);
        return () => {
            clearInterval(timer);
            window.removeEventListener('auth-changed', refresh);
            window.removeEventListener('syncKey-changed', refresh);
            window.removeEventListener('servant-profile-updated', refresh);
            window.removeEventListener('storage', refresh);
        };
    }, []);

    useEffect(() => {
        if (!firestore) return undefined;
        const keys = JSON.parse(scope || '[]').filter(Boolean);
        if (keys.length === 0) return undefined;

        let cancelled = false;
        let queue = Promise.resolve();
        const warnRealtime = (error) => {
            console.warn('[RealtimeSync] Transient listener warning:', error?.message || error);
        };

        const unsubs = [];

        // تفعيل المستمعات اللحظية (onSnapshot) فقط عندما يكون النطاق فصلاً واحداً نشطاً
        // (خادم فصل أو وضع الدخول كخادم للأسرة) لمنع إغراق WebChannel بـ 57 مستمع متزامن!
        if (keys.length === 1) {
            const singleKey = keys[0];
            ['children', 'attendance', 'childIdentities'].forEach((type) => {
                try {
                    const unsub = onSnapshot(
                        collection(firestore, 'Osras', singleKey, type),
                        (snapshot) => {
                            if (snapshot.metadata?.hasPendingWrites || snapshot.metadata?.fromCache) return;
                            queue = queue.then(async () => {
                                if (cancelled) return;
                                const deadline = createSyncDeadline('التحديث اللحظي', SYNC_TIMEOUT_MS);
                                try {
                                    await deadline.run(async () => {
                                        const rows = snapshot
                                            .docChanges()
                                            .filter((change) => change.type !== 'removed')
                                            .map((change) => decodeCloudRecord(change.doc));
                                        if (type === 'attendance') {
                                            await reconcileCloudAttendanceBatch(rows, deadline);
                                        } else {
                                            await reconcileCloudChildrenBatch(rows, deadline);
                                        }
                                    });
                                } finally {
                                    deadline.cancel();
                                }
                            }).catch(warnRealtime);
                        },
                        warnRealtime
                    );
                    unsubs.push(unsub);
                } catch (err) {
                    warnRealtime(err);
                }
            });
        } else {
            // في وضع الكاهن / أمين الخدمة / أمين المرحلة (فصول متعددة):
            // نستمع فقط لتحديثات هيكل الكنيسة المركزي (System/mainConfig) ونعتمد على المزامنة التدريجية (3 فصول في كل دفعة)
            try {
                const unsubStructure = onSnapshot(
                    doc(firestore, 'System', 'mainConfig'),
                    (snap) => {
                        if (cancelled || !snap.exists()) return;
                        if (readScopedStorage('pendingStructureSync') === 'true') return;
                        try {
                            const rawCloudSettings = snap.data() || {};
                            const cleanServices = sanitizeChurchServices(rawCloudSettings.services || [], []);
                            const rawCloudServants = Array.isArray(rawCloudSettings.servants)
                                ? rawCloudSettings.servants
                                : (Array.isArray(rawCloudSettings.authorizedServants) ? rawCloudSettings.authorizedServants : []);
                            const cleanServants = sanitizeAuthorizedServants(rawCloudServants, cleanServices, { fallbackToOfficial: false });
                            const cloudSettings = {
                                ...rawCloudSettings,
                                services: cleanServices,
                                servants: cleanServants,
                            };
                            const localSettingsStr = readScopedStorage('appSettings') || '{}';
                            const localParsed = JSON.parse(localSettingsStr);
                            const merged = { ...localParsed, ...cloudSettings };
                            const serialized = JSON.stringify(merged);
                            if (serialized !== localSettingsStr) {
                                writeScopedStorage('appSettings', serialized);
                                window.dispatchEvent(new Event('servant-profile-updated'));
                            }
                        } catch (_e) {}
                    },
                    () => {}
                );
                unsubs.push(unsubStructure);
            } catch (_e) {}
        }

        const sync = () => {
            if (typeof navigator === 'undefined' || navigator.onLine !== false) {
                syncScopedClassesFromCloud(keys).catch(warnRealtime);
            }
        };
        sync();
        window.addEventListener('online', sync);

        return () => {
            cancelled = true;
            unsubs.forEach((fn) => {
                try { fn?.(); } catch (_e) {}
            });
            window.removeEventListener('online', sync);
        };
    }, [scope]);
}
