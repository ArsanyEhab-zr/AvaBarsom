import { useEffect } from 'react';
import { scopedSyncKeys, syncScopedClassesFromCloud } from '../db/childSync';

/**
 * Keeps scoped cloud-to-local class synchronization active silently in the background
 * without cluttering the user interface with manual sync or maintenance controls.
 */
export default function ScopedSyncButton() {
    useEffect(() => {
        const keys = scopedSyncKeys().sort();
        if (keys.length === 0) return;

        const timer = setTimeout(() => {
            syncScopedClassesFromCloud(keys).catch(() => {});
        }, 0);

        return () => clearTimeout(timer);
    }, []);

    return null;
}
