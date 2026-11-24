import { db } from '../db/database';
import {
    TENANT_CONFIG,
    readScopedStorage,
    writeScopedStorage,
    removeScopedStorage,
} from './tenantConfig';
import {
    OFFICIAL_ST_BARSOUM_SERVANTS,
    sanitizeAuthorizedServants,
    sanitizeChurchServices,
} from './churchStructureSanitizer';

export { sanitizeAuthorizedServants } from './churchStructureSanitizer';

const PROD_PURGE_FLAG = `${TENANT_CONFIG.storagePrefix}prod_demo_purged_v1`;
const LEGACY_DEMO_SEED_FLAGS = [
    'demo_seeded_v5',
    'demo_seeded_v4',
    `${TENANT_CONFIG.storagePrefix}demo_seeded_v5`,
    `${TENANT_CONFIG.storagePrefix}demo_seeded_v4`,
];

function isDemoRecordId(rawId = '') {
    const id = String(rawId || '').trim();
    if (!id) return false;
    return (
        id.startsWith('demo_') ||
        id.startsWith('cur_demo_') ||
        id.startsWith('cur_seed_') ||
        id.startsWith('pt_demo_') ||
        id.startsWith('exam_demo_') ||
        id.startsWith('act_demo_') ||
        id.startsWith('msg_demo_') ||
        id.startsWith('srv_demo_') ||
        id.startsWith('book_grade1_part')
    );
}

/**
 * Production Mode: Automatic demo/fake data seeding is permanently disabled.
 * Opening the application NEVER creates fake children, attendance, points,
 * exams, visitations, messages, demo servants, or demo curricula.
 */
export async function ensureDemoDataSeeded() {
    return false;
}

/**
 * Purges any lingering local Dexie / localStorage demo or test records from
 * browsers that previously opened the app before production launch.
 */
export async function purgeLocalDemoDataOnce() {
    if (typeof window === 'undefined') return false;

    try {
        for (const flag of LEGACY_DEMO_SEED_FLAGS) {
            removeScopedStorage(flag);
            try {
                window.localStorage?.removeItem?.(flag);
            } catch {
                // ignore
            }
        }

        // Clean stale demo sessions from localStorage
        const currentServantRaw = readScopedStorage('currentServant');
        if (currentServantRaw) {
            try {
                const srv = JSON.parse(currentServantRaw);
                if (isDemoRecordId(srv?.id) || String(srv?.name || '').includes('(تجريبي)')) {
                    [
                        'currentServant',
                        'currentSyncKey',
                        'userRole',
                        'assignedOsra',
                        'impersonated_osra',
                        'isSuperAdminImpersonating',
                        'masterSyncKey',
                        'selectedOsra',
                    ].forEach((k) => removeScopedStorage(k));
                }
            } catch {
                // ignore
            }
        }

        const parentChildId = readScopedStorage('parentChildId');
        if (isDemoRecordId(parentChildId)) {
            [
                'parentChildId',
                'parentChildName',
                'parentSyncKey',
                'parentClassName',
                'parentSession',
                'userRole',
            ].forEach((k) => removeScopedStorage(k));
        }

        // Clean fake servants & fake seeded curricula from local appSettings
        const rawSettings = readScopedStorage('appSettings');
        if (rawSettings) {
            try {
                const parsed = JSON.parse(rawSettings);
                const rawServices = Array.isArray(parsed?.services) ? parsed.services : [];
                const cleanedServices = sanitizeChurchServices(rawServices, []).map((svc) => ({
                    ...svc,
                    osras: (svc?.osras || []).map((osra) => ({
                        ...osra,
                        curricula: Array.isArray(osra?.curricula)
                            ? osra.curricula.filter((c) => !isDemoRecordId(c?.id))
                            : [],
                    })),
                }));
                const cleanedServants = sanitizeAuthorizedServants(
                    parsed?.servants || parsed?.authorizedServants || [],
                    cleanedServices,
                    { fallbackToOfficial: false }
                );
                writeScopedStorage('appSettings', JSON.stringify({
                    ...parsed,
                    services: cleanedServices,
                    servants: cleanedServants,
                    authorizedServants: cleanedServants,
                }));
            } catch {
                // ignore
            }
        }

        if (readScopedStorage(PROD_PURGE_FLAG) === 'true') {
            return false;
        }

        const deleteMatchingFromTable = async (table, predicate) => {
            if (!table || typeof table.toArray !== 'function' || typeof table.bulkDelete !== 'function') return;
            const rows = await table.toArray();
            const keysToDelete = rows
                .filter((row) => row && predicate(row))
                .map((row) => row.id)
                .filter((id) => id !== undefined && id !== null);
            if (keysToDelete.length > 0) {
                await table.bulkDelete(keysToDelete);
            }
        };

        await Promise.all([
            deleteMatchingFromTable(db?.children, (r) => isDemoRecordId(r.id) || r.isSeededDemo === true),
            deleteMatchingFromTable(db?.attendance, (r) => isDemoRecordId(r.id) || isDemoRecordId(r.childId)),
            deleteMatchingFromTable(db?.pointsLogs, (r) => isDemoRecordId(r.id) || isDemoRecordId(r.childId)),
            deleteMatchingFromTable(db?.curricula, (r) => isDemoRecordId(r.id)),
            deleteMatchingFromTable(db?.exams, (r) => isDemoRecordId(r.id) || isDemoRecordId(r.firebaseId)),
            deleteMatchingFromTable(db?.grades, (r) => isDemoRecordId(r.id) || isDemoRecordId(r.examId) || isDemoRecordId(r.childId)),
            deleteMatchingFromTable(db?.activities, (r) => isDemoRecordId(r.id)),
            deleteMatchingFromTable(db?.visitations, (r) => isDemoRecordId(r.id) || isDemoRecordId(r.childId)),
            deleteMatchingFromTable(db?.messages, (r) => isDemoRecordId(r.id) || r.isSeededDemo === true),
        ]);

        writeScopedStorage(PROD_PURGE_FLAG, 'true');
        return true;
    } catch {
        return false;
    }
}

export const DEMO_PARENT_ACCOUNT = {
    id: 'demo_parent_abanoub',
    name: 'ولي أمر: أبانوب عماد لطفي',
    role: 'ولي أمر',
    roleTier: 'parent',
    isParent: true,
    phone: '01223344003',
    fatherPhone: '01223344003',
    parentChildId: 'demo_kg2_1',
    childId: 'demo_kg2_1',
    childName: 'أبانوب عماد لطفي',
    syncKey: 'كي جي 2',
    className: 'كي جي 2',
    assignedOsra: 'كي جي 2',
};

export function getDemoRoleAccounts() {
    return OFFICIAL_ST_BARSOUM_SERVANTS;
}

/**
 * Static RBAC hierarchy metadata preserved strictly for automated RBAC / edition unit tests.
 * Never rendered or activated in production UI.
 */
export function getDemoHierarchyAccounts() {
    const priest = OFFICIAL_ST_BARSOUM_SERVANTS.find((s) => s.id === 'srv_demo_priest') || OFFICIAL_ST_BARSOUM_SERVANTS[0];
    const stageLeader = OFFICIAL_ST_BARSOUM_SERVANTS.find((s) => s.id === 'srv_demo_stage_ss') || OFFICIAL_ST_BARSOUM_SERVANTS[2];
    const primaryServant = OFFICIAL_ST_BARSOUM_SERVANTS.find((s) => s.id === 'srv_demo_primary') || OFFICIAL_ST_BARSOUM_SERVANTS[3];
    return [
        {
            ...priest,
            tierKey: 'super_admin',
            tierNumber: 1,
            displayTitle: 'الأب الكاهن / أمين الخدمة العام',
            subtitle: 'صلاحية شاملة لكل المراحل وهيكل الخدمة',
            badgeText: 'المستوى 1 • إدارة عامة',
        },
        {
            ...stageLeader,
            tierKey: 'stage_leader',
            tierNumber: 2,
            displayTitle: 'أمين مرحلة مدارس الأحد',
            subtitle: 'إدارة فصول مجموعة مدارس الأحد فقط',
            badgeText: 'المستوى 2 • أمين مرحلة',
        },
        {
            ...primaryServant,
            tierKey: 'class_servant',
            tierNumber: 3,
            displayTitle: 'خادم رابعة ابتدائي',
            subtitle: 'صلاحية حصرية لفصل رابعة ابتدائي فقط',
            badgeText: 'المستوى 3 • خادم فصل',
        },
        {
            ...DEMO_PARENT_ACCOUNT,
            tierKey: 'parent',
            tierNumber: 4,
            displayTitle: 'بوابة ولي الأمر - أبانوب عماد',
            subtitle: 'متابعة حضور ونقاط ومناهج أبانوب عماد (كي جي 2)',
            badgeText: 'المستوى 4 • ولي أمر',
        },
    ];
}

/**
 * Disabled in production mode — returns '/login' without creating fake sessions or seeding data.
 */
export async function activateDemoAccountSession() {
    return '/login';
}
