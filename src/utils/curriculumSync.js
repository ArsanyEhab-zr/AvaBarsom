/**
 * Legacy compatibility facade — all logic lives in ./curriculumEngine.js
 */
export {
    CURRICULUM_CATEGORIES,
    CURRICULUM_STATUSES,
    buildDefaultCurriculaForOsra,
    hydrateServicesWithCurricula,
    buildSampleCurriculumPdfDataUri,
    getOsraCurricula,
    saveOsraCurriculumItem,
    deleteOsraCurriculumItem,
    syncOsraCurriculaToDb,
    syncAllServicesCurriculaToDb,
    toDbCurriculumRow,
    readFileAsAttachment,
    openCurriculumAttachment,
    triggerCurriculumDownload,
    toEmbeddablePdfUrl
} from './curriculumEngine.js';

import {
    saveOsraCurriculumItem,
    deleteOsraCurriculumItem
} from './curriculumEngine.js';

export function syncLessonToAppSettings(lesson, action = 'upsert') {
    const targetSyncKey = lesson?.syncKey || lesson?.serviceName;
    if (!targetSyncKey || !lesson?.id) return;
    if (action === 'delete') {
        void deleteOsraCurriculumItem(targetSyncKey, lesson.id, { syncToCloud: false });
        return;
    }
    void saveOsraCurriculumItem(targetSyncKey, lesson, {
        serviceName: lesson.serviceName,
        syncToCloud: false
    });
}
