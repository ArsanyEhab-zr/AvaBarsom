import test from 'node:test';
import assert from 'node:assert/strict';
import { db, remote } from './sync-mocks.mjs';
import { getCanonicalActiveChildren, getValidatedClassAttendance, consolidateLocalDexieDuplicates, createCanonicalChildRecord, generateClassScopedQrId } from '../src/utils/churchDataEngine.js';
import { attendanceIdentity, resolveAttendanceChild } from '../src/utils/childIdentity.js';
import { deleteChildEverywhere, restoreChildEverywhere, syncScopedClassesFromCloud, reconcileCloudChild, pushChildSafely, mergeChildRecordsPreservingPhoto } from '../src/db/childSync.js';
import { BLANK_CLASS_TEMPLATE_HEADERS, buildBlankClassTemplateSampleRow, formatClassMonthlyExcelFilename, buildClassExcelExportRows } from '../src/utils/excelClassHelpers.js';
import { getDefaultServiceDateForClass } from '../src/utils/serviceWeek.js';
import { getScopedStorageKey } from '../src/utils/tenantConfig.js';
const storage = new Map();
globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) };
globalThis.Event = class { constructor(type) { this.type = type; } };
globalThis.window = { localStorage, dispatchEvent: () => {} };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
const child = { id: 7, cloudId: 'cloud-A', name: 'أبانوب مينا عماد', syncKey: 'class-A', updatedAt: 1 };
const row = { date: '2026-11-13', type: 'service', status: 'present', syncKey: 'class-A', childId: 7, updatedAt: 1 };
const reset = async () => { for (const t of [db.children,db.attendance,db.grades]) await t.clear(); remote.clear(); storage.clear(); localStorage.setItem('currentSyncKey', 'MASTER_ACCESS'); localStorage.setItem('appSettings', JSON.stringify({services:[{osras:[{syncKey:'class-A'},{syncKey:'class-B'}]}]})); navigator.onLine=false; };

test('aliases, name fallback, transitive duplicates and empty scope', () => {
 const data = getCanonicalActiveChildren([child, {...child,id:'legacy',cloudId:undefined,qrId:'QR'}, {...child,id:'cloud-A',name:'ابانوب مينا عماد'}]);
 assert.equal(data.activeChildren.length,1);
 for(const id of [7,'legacy','QR','cloud-A']) assert.ok(resolveAttendanceChild({...row,childId:id},data));
 assert.ok(resolveAttendanceChild({...row,childId:'unknown',childName:child.name},data));
 assert.equal(getCanonicalActiveChildren([child], []).activeChildren.length,0);
 assert.equal(resolveAttendanceChild({...row,syncKey:'class-B'},data),undefined);
});
test('latest absent/deleted attendance wins; all-absent class is recorded', () => {
 const data=getCanonicalActiveChildren([child]);
 let result=getValidatedClassAttendance([row,{...row,updatedAt:2,status:'absent'}],data);
 assert.equal(result.presentCount,0); assert.equal(result.byClass['class-A'].hasRecordedAttendance,true);
 result=getValidatedClassAttendance([row,{...row,updatedAt:3,isDeleted:true}],data);
 assert.equal(result.presentCount,0); assert.equal(result.byClass['class-A'].hasRecordedAttendance,false);
});
test('child tombstone beats dirty edits; explicit newer restoration survives', () => {
 const tomb={...child,isDeleted:true,deletedAt:10,updatedAt:10};
 assert.equal(getCanonicalActiveChildren([tomb,{...child,id:8,updatedAt:99,isDirty:true}]).activeChildren.length,0);
 assert.equal(getCanonicalActiveChildren([tomb,{...child,id:8,updatedAt:11,restoredAt:11}]).activeChildren.length,1);
});
test('physical dedup preserves aliases, attendance and unresolved records without dirtying', async () => {
 await reset(); await db.children.put(child); await db.children.put({...child,id:'legacy',updatedAt:2});
 await db.attendance.add(row); await db.attendance.add({...row,childId:'unknown',childName:'not downloaded'});
 await consolidateLocalDexieDuplicates();
 assert.equal((await db.children.toArray()).length,1);
 const rows=await db.attendance.toArray(); assert.equal(rows.length,2); assert.equal(rows[0].childId,'cloud-A'); assert.ok(!rows[0].isDirty);
 assert.ok(getCanonicalActiveChildren(await db.children.toArray()).childMapById.has('7'));
});
test('offline delete marks all copies and attendance; old cloud cannot clear pending delete', async () => {
 await reset(); await db.children.put(child); await db.children.put({...child,id:'legacy'}); await db.attendance.add(row);
 const result=await deleteChildEverywhere(child,'خادم'); assert.equal(result.pendingSync,true);
 await reconcileCloudChild({...child,id:'cloud-A',cloudId:'cloud-A'});
 assert.ok((await db.children.toArray()).every(c=>c.isDeleted && c.isDirty));
 assert.equal((await db.attendance.toArray())[0].isDeleted,true);
 assert.ok(localStorage.getItem(getScopedStorageKey('deleted_children_tombstones_v1')).includes('class-A::'));
});
test('cloud tombstone suppresses stale offline dirty copy and cannot be overwritten', async () => {
 await reset(); await db.children.put({...child,isDirty:true,updatedAt:100});
 remote.set('Osras/class-A/children/cloud-A',{...child,isDeleted:true,deletedAt:50,updatedAt:50});
 await syncScopedClassesFromCloud(['class-A']);
 assert.equal((await db.children.get(7)).isDeleted,true);
 assert.equal(remote.get('Osras/class-A/children/cloud-A').isDeleted,true);
});
test('prefetched tombstone prevents child push', async () => {
 await reset(); const dirty={...child,isDirty:true}; await db.children.put(dirty);
 remote.set('Osras/class-A/children/cloud-A',{...child,isDeleted:true,deletedAt:50});
 await pushChildSafely(dirty,[{...child,isDeleted:true,deletedAt:50}]);
 assert.equal(remote.get('Osras/class-A/children/cloud-A').isDeleted,true);
 assert.equal((await db.children.get(7)).isDeleted,true);
});
test('multi-class full pull recovers old attendance despite poisoned global checkpoint', async () => {
 await reset(); localStorage.setItem('lastSyncTime','2099-01-01');
 for(const key of ['class-A','class-B']) {
  remote.set(`Osras/${key}/children/${key}`,{...child,id:key,syncKey:key});
  remote.set(`Osras/${key}/attendance/old`,{...row,childId:key,syncKey:key});
 }
 await syncScopedClassesFromCloud(['class-A','class-B']);
 assert.equal((await db.children.toArray()).length,2); assert.equal((await db.attendance.toArray()).length,2);
 for(const key of ['class-A','class-B']) assert.ok(localStorage.getItem(getScopedStorageKey(`lastSyncTime_${key}`)));
});
test('explicit restore clears registry and updates cloud tombstone, without restoring old attendance', async () => {
 await reset(); await db.children.put(child); await db.attendance.add(row);
 await deleteChildEverywhere(child,'خادم');
 await new Promise(resolve=>setTimeout(resolve,2)); navigator.onLine=true;
 await restoreChildEverywhere(await db.children.get(7),'أمين');
 assert.equal(remote.get('Osras/class-A/children/cloud-A').isDeleted,false);
 assert.equal((await db.children.get(7)).isDeleted,false);
 assert.equal((await db.attendance.toArray())[0].isDeleted,true);
 assert.equal(localStorage.getItem(getScopedStorageKey('deleted_children_tombstones_v1')),'{}');
});
test('Friday class uses Friday even on Thursday cycle boundary', () => {
 assert.equal(getDefaultServiceDateForClass('class-A','ابتدائي',new Date(2026,10,12,12)),'2026-11-13');
 assert.equal(getDefaultServiceDateForClass('class-B','ثانوي',new Date(2026,10,12,12)),'2026-11-12');
});
test('a clean local record is never uploaded by reconciliation', async () => {
 await reset(); await db.children.put({...child,isDirty:false});
 await syncScopedClassesFromCloud(['class-A']);
 assert.equal(remote.size,0);
});
test('identical cloud IDs in different classes do not overwrite local roster', async () => {
 await reset();
 for(const key of ['class-A','class-B']) remote.set(`Osras/${key}/children/shared`,{...child,id:'shared',syncKey:key});
 await syncScopedClassesFromCloud(['class-A','class-B']);
 assert.equal((await db.children.toArray()).length,2);
});
test('prefetched name guard suppresses a duplicate with an unknown ID', async () => {
 await reset(); const dirty={...child,id:'new-id',cloudId:'new-id',isDirty:true}; await db.children.put(dirty);
 const name='ابانوب مينا عماد';
 remote.set(`Osras/class-A/childIdentities/${encodeURIComponent(name)}`,{...child,isDeleted:true,deletedAt:100});
 await pushChildSafely(dirty,[{...child,isDeleted:true,deletedAt:100}]);
 assert.equal(remote.has('Osras/class-A/children/new-id'),false);
 assert.equal((await db.children.get('new-id')).isDeleted,true);
});
test('role scope includes all assigned classes and rejects out-of-scope pulls', async () => {
 await reset(); localStorage.setItem('currentSyncKey','class-A');
 localStorage.setItem('currentServant', JSON.stringify({role:'خادم مرحلة',allowedClasses:['class-A']}));
 remote.set('Osras/class-B/children/B',{...child,id:'B',syncKey:'class-B'});
 await syncScopedClassesFromCloud(['class-B']);
 assert.equal((await db.children.toArray()).length,0);
 localStorage.setItem('currentServant', JSON.stringify({role:'خادم مرحلة',allowedClasses:['class-A','class-B']}));
 await syncScopedClassesFromCloud(['class-A','class-B']);
 assert.equal((await db.children.toArray()).length,1);
});
test('all supported leader role labels resolve the full configured scope', async () => {
 await reset(); localStorage.setItem('currentSyncKey','class-A');
 const { scopedSyncKeys } = await import('../src/db/childSync.js');
 for (const role of ['أمين خدمة','أمين الخدمة','أمين الخدمة العام','كاهن','SUPER_ADMIN']) {
  localStorage.setItem('currentServant',JSON.stringify({role}));
  assert.deepEqual(scopedSyncKeys().sort(),['class-A','class-B'], role);
 }
 for (const role of ['أمين مرحلة','أمين المرحلة','stage_admin','خادم مرحلة']) {
  localStorage.setItem('currentServant',JSON.stringify({role,allowedClasses:['class-B']}));
  assert.deepEqual(scopedSyncKeys(),['class-B'],role);
 }
});
test('an explicit unknown stage never falls back to another class', async () => {
 await reset(); localStorage.setItem('currentSyncKey','class-A');
 localStorage.setItem('currentServant',JSON.stringify({role:'stage_admin',assignedStages:['missing-stage']}));
 const { scopedSyncKeys } = await import('../src/db/childSync.js');
 assert.deepEqual(scopedSyncKeys(),[]);
});
test('servant impersonation switches Priest/Master scope to single-class servant and restores on exit', async () => {
 await reset();
 localStorage.setItem('currentSyncKey', 'MASTER_ACCESS');
 localStorage.setItem('currentServant', JSON.stringify({ role: 'كاهن', name: 'أبونا' }));
 const { scopedSyncKeys } = await import('../src/db/childSync.js');
 const { startOsraImpersonation, exitOsraImpersonation, resolveServantNotificationScope } = await import('../src/utils/notificationScopeEngine.js');
 const { formatCopticDate } = await import('../src/utils/serviceWeek.js');
 assert.deepEqual(scopedSyncKeys().sort(), ['class-A', 'class-B']);

 startOsraImpersonation({ syncKey: 'class-B', name: 'ثانية إعدادي' }, 'MASTER_ACCESS');
 assert.deepEqual(scopedSyncKeys(), ['class-B']);
 const impScope = resolveServantNotificationScope();
 assert.equal(impScope.tier, 'class_servant');
 assert.equal(impScope.isImpersonating, true);
 assert.equal(impScope.primarySyncKey, 'class-B');

 exitOsraImpersonation();
 assert.deepEqual(scopedSyncKeys().sort(), ['class-A', 'class-B']);
 assert.equal(resolveServantNotificationScope().tier, 'master_detailed');

 const copticStr = formatCopticDate(new Date(2026, 10, 12, 12));
 assert.ok(copticStr.includes('هاتور'), `Expected Arabic Coptic month name in "${copticStr}"`);
});
test('multi-day schedules resolve Sunday School, Prep, Secondary, University, and General Servants dates', async () => {
 await reset();
 localStorage.removeItem('appSettings');
 const { getClassScheduleConfig, getDefaultServiceDateForClass } = await import('../src/utils/serviceWeek.js');

 // Sunday School (الأحد والخميس + قداس الجمعة)
 const ssCfg = getClassScheduleConfig('sunday_school_primary', 'ابتدائي بنين وبنات');
 assert.deepEqual(ssCfg.serviceDays, ['sunday', 'thursday']);
 assert.equal(ssCfg.liturgyDay, 'friday');
 assert.equal(getDefaultServiceDateForClass('sunday_school_primary', 'ابتدائي بنين وبنات', new Date(2026, 10, 12, 12)), '2026-11-12'); // Thu
 assert.equal(getDefaultServiceDateForClass('sunday_school_primary', 'ابتدائي بنين وبنات', new Date(2026, 10, 15, 12)), '2026-11-15'); // Sun
 assert.equal(getDefaultServiceDateForClass('sunday_school_primary', 'ابتدائي بنين وبنات', new Date(2026, 10, 16, 12)), '2026-11-15'); // Mon -> most recent Sun

 // Sunday School Servants roster inherits Sunday School schedule
 const ssServantsCfg = getClassScheduleConfig('sunday_school_servants', 'خدام مدارس الأحد');
 assert.deepEqual(ssServantsCfg.serviceDays, ['sunday', 'thursday']);
 assert.equal(ssServantsCfg.liturgyDay, 'friday');

 // Prep (الجمعة), Secondary (الخميس), University (الاثنين), General Servants (الأربعاء)
 assert.deepEqual(getClassScheduleConfig('prep_boys', 'إعدادي بنين').serviceDays, ['friday']);
 assert.equal(getDefaultServiceDateForClass('prep_boys', 'إعدادي بنين', new Date(2026, 10, 12, 12)), '2026-11-13');
 assert.deepEqual(getClassScheduleConfig('sec_girls', 'ثانوي بنات').serviceDays, ['thursday']);
 assert.equal(getDefaultServiceDateForClass('sec_girls', 'ثانوي بنات', new Date(2026, 10, 12, 12)), '2026-11-12');
 assert.deepEqual(getClassScheduleConfig('university_youth', 'خدمة جامعة').serviceDays, ['monday']);
 assert.equal(getDefaultServiceDateForClass('university_youth', 'خدمة جامعة', new Date(2026, 10, 16, 12)), '2026-11-16');
 assert.deepEqual(getClassScheduleConfig('general_servants_meeting', 'اجتماع الخدام العام').serviceDays, ['wednesday']);
 assert.equal(getDefaultServiceDateForClass('general_servants_meeting', 'اجتماع الخدام العام', new Date(2026, 10, 18, 12)), '2026-11-18');
});
test('church structure defaults and stage inference include Sunday School servants and zero legacy branding', async () => {
 const { DEFAULT_CHURCH_SERVICES, DEFAULT_CHURCH_OSRAS, inferStageFromClass } = await import('../src/utils/notificationScopeEngine.js');
 assert.ok(DEFAULT_CHURCH_SERVICES.length >= 5);
 assert.ok(DEFAULT_CHURCH_OSRAS.some(o => o.syncKey === 'خدام مدارس الأحد' && o.isServantsRoster === true));
 assert.equal(inferStageFromClass('خدام مدارس الأحد'), 'خدام مدارس الأحد');
 assert.equal(inferStageFromClass('اجتماع الخدام العام'), 'اجتماع الخدام العام');
 const serialized = JSON.stringify({ DEFAULT_CHURCH_SERVICES, DEFAULT_CHURCH_OSRAS });
 for (const legacy of ['مارجرجس', 'مار جرجس', 'غمازة', 'غمازه', 'ghamaza', 'gamaza', 'gergs']) {
  assert.equal(serialized.toLowerCase().includes(legacy), false, `Found legacy term: ${legacy}`);
 }
});
test('aggregateMonthlyPoints ranks monthly totals cleanly and ignores deleted/other-month entries', async () => {
 const { aggregateMonthlyPoints } = await import('../src/utils/pointsMath.js');
 const demoChildren = [
  { id: 'c1', name: 'كيرلس', syncKey: 'إعدادي بنين' },
  { id: 'c2', name: 'مارينا', syncKey: 'إعدادي بنات' }
 ];
 const logs = [
  { id: 'l1', childId: 'c1', monthKey: '2026-11', points: 10, category: 'attendance' },
  { id: 'l2', childId: 'c1', monthKey: '2026-11', points: 15, category: 'liturgy' },
  { id: 'l3', childId: 'c1', monthKey: '2026-11', points: 5, category: 'memorization', isDeleted: true },
  { id: 'l4', childId: 'c2', monthKey: '2026-11', points: 10, category: 'attendance' },
  { id: 'l5', childId: 'c2', monthKey: '2026-11', points: 20, category: 'custom' },
  { id: 'l6', childId: 'c1', monthKey: '2026-10', points: 50, category: 'custom' }
 ];
 const board = aggregateMonthlyPoints({ pointsLogs: logs, children: demoChildren, monthKey: '2026-11' });
 assert.equal(board.length, 2);
 assert.equal(board[0].childId, 'c2');
 assert.equal(board[0].totalPoints, 30);
 assert.equal(board[0].breakdown.custom, 20);
 assert.equal(board[1].childId, 'c1');
 assert.equal(board[1].totalPoints, 25);
 assert.equal(board[1].breakdown.liturgy, 15);
});
test('per-class multi-curriculum hydration pre-seeds all default classes and preserves unlimited items', async () => {
 const { DEFAULT_CHURCH_SERVICES } = await import('../src/utils/notificationScopeEngine.js');
 const { hydrateServicesWithCurricula, CURRICULUM_CATEGORIES } = await import('../src/utils/curriculumData.js');
 for (const srv of DEFAULT_CHURCH_SERVICES) {
  assert.ok(Array.isArray(srv.osras) && srv.osras.length > 0);
  for (const osra of srv.osras) {
   assert.ok(Array.isArray(osra.curricula) && osra.curricula.length >= 2, `Expected >=2 curricula for ${osra.name}`);
   for (const c of osra.curricula) {
    assert.ok(c.id && c.title && CURRICULUM_CATEGORIES.includes(c.category));
   }
  }
 }
 const custom = hydrateServicesWithCurricula([{
  id: 'srv_custom',
  name: 'خدمة اختبار',
  osras: [
   { id: 'o1', name: 'فصل مخصص', syncKey: 'custom_1', pdfUrl: 'https://example.com/old.pdf', curriculumName: 'مذكرة قديمة' },
   { id: 'o2', name: 'فصل متعدد', syncKey: 'custom_2', curricula: [
    { id: 'a', title: 'منهج ١', category: CURRICULUM_CATEGORIES[0] },
    { id: 'b', title: 'منهج ٢', category: CURRICULUM_CATEGORIES[1] },
    { id: 'c', title: 'منهج ٣', category: CURRICULUM_CATEGORIES[2] },
    { id: 'd', title: 'منهج ٤', category: CURRICULUM_CATEGORIES[3] }
   ]}
  ]
 }]);
 assert.equal(custom[0].osras[0].curricula[0].fileUrl, 'https://example.com/old.pdf');
 assert.equal(custom[0].osras[1].curricula.length, 4);
});

test('getOsraCurricula strictly isolates per-family syncKey items, merges legacy PDFs, and honors tombstones', async () => {
 const { getOsraCurricula, isPdfCurriculumItem, toEmbeddablePdfUrl } = await import('../src/utils/curriculumEngine.js');

 const osrasList = [
  {
   syncKey: 'خدام مدارس الأحد',
   name: 'خدام مدارس الأحد',
   serviceName: 'مجموعة مدارس الأحد',
   pdfUrl: 'https://drive.google.com/file/d/ABC123XYZ/view',
   curriculumName: 'كتاب منهج خدام مدارس الأحد',
   curricula: [
    { id: 'c_khedma_1', title: 'درس تحضير الوسائل', category: 'درس كتاب مقدس وعقيدة', content: 'شرح التحضير', updatedAt: '2026-11-14T08:00:00Z' },
    { id: 'c_deleted', title: 'درس محذوف', category: 'ألحان وتسبحة', updatedAt: '2026-11-14T07:00:00Z' }
   ]
  },
  {
   syncKey: 'خدمة جامعة',
   name: 'خدمة جامعة',
   serviceName: 'خدمة جامعة',
   curricula: [
    { id: 'c_uni_1', title: 'درس لا يجب أن يظهر لخدام مدارس الأحد', category: 'درس كتاب مقدس وعقيدة' }
   ]
  }
 ];

 const dexieRows = [
  { id: 'c_khedma_1', syncKey: 'خدام مدارس الأحد', title: 'درس تحضير الوسائل (محدّث)', category: 'درس كتاب مقدس وعقيدة', content: 'محتوى محدث', updatedAt: '2026-11-14T12:00:00Z', isDeleted: 0 },
  { id: 'c_khedma_2', syncKey: 'خدام مدارس الأحد', title: 'لحن إبنوتي', category: 'ألحان وتسبحة', isDeleted: 0 },
  { id: 'c_deleted', syncKey: 'خدام مدارس الأحد', title: 'درس محذوف', isDeleted: 1 },
  { id: 'c_uni_1', syncKey: 'خدمة جامعة', title: 'الإيمان والعقل', isDeleted: 0 },
  { id: 'c_generic', syncKey: 'عام الخدمة', title: 'درس عام لا يخص الأسرة', isDeleted: 0 }
 ];

 const result = getOsraCurricula('خدام مدارس الأحد', dexieRows, osrasList);
 const titles = result.map((r) => r.title);

 assert.ok(titles.includes('كتاب منهج خدام مدارس الأحد'), 'Expected legacy pdfUrl to be migrated as PDF item');
 assert.ok(titles.includes('درس تحضير الوسائل (محدّث)'), 'Expected latest Dexie version to win deduplication');
 assert.ok(titles.includes('لحن إبنوتي'), 'Expected Dexie-only item for same syncKey to appear');
 assert.ok(!titles.includes('درس محذوف'), 'Deleted tombstone id must be excluded');
 assert.ok(!titles.some((t) => t.includes('الإيمان والعقل') || t.includes('لا يجب أن يظهر') || t.includes('درس عام')), 'Other families and generic keys must NEVER leak');

 const pdfItems = result.filter((r) => isPdfCurriculumItem(r));
 assert.equal(pdfItems.length, 1);
 assert.equal(toEmbeddablePdfUrl(pdfItems[0].fileUrl), 'https://drive.google.com/file/d/ABC123XYZ/preview');
});

test('resolveUserAccessScope enforces strict 4-tier church hierarchy (Super Admin, Stage Leader, Class Servant, Parent) & impersonation boundaries', async () => {
 const { resolveUserAccessScope, DEFAULT_CHURCH_SERVICES } = await import('../src/utils/notificationScopeEngine.js');
 const { getDemoHierarchyAccounts } = await import('../src/utils/demoSeeder.js');

 const accounts = getDemoHierarchyAccounts();
 assert.equal(accounts.length, 4);
 assert.deepEqual(
  accounts.map((a) => a.tierKey),
  ['super_admin', 'stage_leader', 'class_servant', 'parent']
 );

 const prevLocalStorage = globalThis.localStorage;
 const prevWindow = globalThis.window;
 const store = new Map();
 const mockStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(String(k), String(v)); },
  removeItem: (k) => { store.delete(String(k)); },
  clear: () => { store.clear(); }
 };
 Object.defineProperty(globalThis, 'localStorage', { value: mockStorage, configurable: true, writable: true });
 Object.defineProperty(globalThis, 'window', { value: { localStorage: mockStorage }, configurable: true, writable: true });

 try {
  const settings = { services: DEFAULT_CHURCH_SERVICES };

  // 0. Guest (unauthenticated)
  mockStorage.clear();
  const guestScope = resolveUserAccessScope(settings);
  assert.equal(guestScope.isGuest, true);
  assert.equal(guestScope.roleTier, 'guest');
  assert.deepEqual(guestScope.allowedSyncKeys, []);

  // 1. Tier 1 — Priest / Super Admin
  mockStorage.clear();
  mockStorage.setItem('userRole', 'super_admin');
  mockStorage.setItem('currentSyncKey', 'MASTER_ACCESS');
  mockStorage.setItem('currentServant', JSON.stringify(accounts[0]));
  const tier1 = resolveUserAccessScope(settings);
  assert.equal(tier1.roleTier, 'super_admin');
  assert.equal(tier1.isSuperAdmin, true);
  assert.equal(tier1.canAccessSystemAdmin, true);
  assert.equal(tier1.canAccessMasterDashboard, true);
  assert.equal(tier1.canSwitchClasses, true);
  assert.ok(tier1.allowedSyncKeys.includes('رابعة ابتدائي'));
  assert.ok(tier1.allowedSyncKeys.includes('إعدادي بنين'));
  assert.ok(tier1.allowedSyncKeys.includes('خدمة جامعة'));

  // 2. Tier 2 — Stage Leader (مجموعة مدارس الأحد only)
  mockStorage.clear();
  mockStorage.setItem('userRole', 'stage_leader');
  mockStorage.setItem('currentSyncKey', 'STAGE_ADMIN');
  mockStorage.setItem('currentServant', JSON.stringify(accounts[1]));
  const tier2 = resolveUserAccessScope(settings);
  assert.equal(tier2.roleTier, 'stage_leader');
  assert.equal(tier2.isStageLeader, true);
  assert.equal(tier2.isSuperAdmin, false);
  assert.equal(tier2.canAccessSystemAdmin, false);
  assert.equal(tier2.canAccessMasterDashboard, true);
  assert.equal(tier2.canSwitchClasses, true);
  assert.equal(tier2.stageName, 'مجموعة مدارس الأحد');
  assert.ok(tier2.allowedSyncKeys.includes('كي جي 2'));
  assert.ok(tier2.allowedSyncKeys.includes('رابعة ابتدائي'));
  assert.ok(!tier2.allowedSyncKeys.includes('إعدادي بنين'), 'Stage leader must NOT access Prep stage');
  assert.ok(!tier2.allowedSyncKeys.includes('خدمة جامعة'), 'Stage leader must NOT access University stage');

  // 2b. Stage Leader Impersonating a single class -> temporarily locked to class_servant unless ignoreImpersonation=true
  mockStorage.setItem('isSuperAdminImpersonating', 'true');
  mockStorage.setItem('impersonated_osra', JSON.stringify({ syncKey: 'رابعة ابتدائي', name: 'رابعة ابتدائي' }));
  mockStorage.setItem('masterSyncKey', 'STAGE_ADMIN');
  mockStorage.setItem('currentSyncKey', 'رابعة ابتدائي');
  const impersonatedScope = resolveUserAccessScope(settings);
  assert.equal(impersonatedScope.isImpersonating, true);
  assert.equal(impersonatedScope.roleTier, 'class_servant');
  assert.deepEqual(impersonatedScope.allowedSyncKeys, ['رابعة ابتدائي']);
  assert.equal(impersonatedScope.canAccessMasterDashboard, false);
  const underlyingStageScope = resolveUserAccessScope(settings, [], { ignoreImpersonation: true });
  assert.equal(underlyingStageScope.roleTier, 'stage_leader');
  assert.ok(!underlyingStageScope.allowedSyncKeys.includes('إعدادي بنين'));

  // 3. Tier 3 — Class Servant (رابعة ابتدائي only)
  mockStorage.clear();
  mockStorage.setItem('userRole', 'class_servant');
  mockStorage.setItem('currentSyncKey', 'رابعة ابتدائي');
  mockStorage.setItem('currentServant', JSON.stringify(accounts[2]));
  const tier3 = resolveUserAccessScope(settings);
  assert.equal(tier3.roleTier, 'class_servant');
  assert.equal(tier3.isClassServant, true);
  assert.equal(tier3.canAccessSystemAdmin, false);
  assert.equal(tier3.canAccessMasterDashboard, false);
  assert.equal(tier3.canSwitchClasses, false);
  assert.deepEqual(tier3.allowedSyncKeys, ['رابعة ابتدائي']);

  // 4. Tier 4 — Parent (strict single-child lock)
  mockStorage.clear();
  mockStorage.setItem('userRole', 'parent');
  mockStorage.setItem('parentChildId', 'demo_kg2_1');
  const tier4 = resolveUserAccessScope(settings);
  assert.equal(tier4.roleTier, 'parent');
  assert.equal(tier4.isParent, true);
  assert.equal(tier4.isGuest, false);
  assert.equal(tier4.parentChildId, 'demo_kg2_1');
  assert.equal(tier4.canAccessSystemAdmin, false);
  assert.equal(tier4.canAccessMasterDashboard, false);
  assert.equal(tier4.canSwitchClasses, false);
  assert.deepEqual(tier4.allowedSyncKeys, []);
 } finally {
  if (prevLocalStorage === undefined) {
   delete globalThis.localStorage;
  } else {
   Object.defineProperty(globalThis, 'localStorage', { value: prevLocalStorage, configurable: true, writable: true });
  }
  if (prevWindow === undefined) {
   delete globalThis.window;
  } else {
   Object.defineProperty(globalThis, 'window', { value: prevWindow, configurable: true, writable: true });
  }
 }
});

test('Multi-edition isolation enforces strict admin, servant, and parent boundaries via getAppEdition', async () => {
 const { resolveUserAccessScope, DEFAULT_CHURCH_SERVICES } = await import('../src/utils/notificationScopeEngine.js');
 const { getDemoHierarchyAccounts } = await import('../src/utils/demoSeeder.js');
 const {
  getAppEdition,
  setDemoEditionOverride,
  getEditionConfig,
  getActiveLogoUrl,
  getLogoUrl,
  DEMO_EDITION_OVERRIDE_KEY,
 } = await import('../src/utils/tenantConfig.js');

 const accounts = getDemoHierarchyAccounts();
 const settings = { services: DEFAULT_CHURCH_SERVICES };

 const prevLocalStorage = globalThis.localStorage;
 const prevWindow = globalThis.window;
 const store = new Map();
 const mockStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(String(k), String(v)); },
  removeItem: (k) => { store.delete(String(k)); },
  clear: () => { store.clear(); }
 };
 Object.defineProperty(globalThis, 'localStorage', { value: mockStorage, configurable: true, writable: true });
 Object.defineProperty(globalThis, 'window', { value: { localStorage: mockStorage }, configurable: true, writable: true });

 try {
  mockStorage.clear();
  assert.equal(getAppEdition(), 'all');
  assert.equal(getActiveLogoUrl('admin'), '/editions/admin/logo.png');
  assert.equal(getActiveLogoUrl('servant'), '/editions/servant/logo.png');
  assert.equal(getActiveLogoUrl('parent'), '/editions/parent/logo.png');

  // admin edition allows Tier 1/2, rejects standalone class_servant & parent
  setDemoEditionOverride('admin');
  assert.equal(getAppEdition(), 'admin');
  assert.equal(getLogoUrl('/logo.png'), '/editions/admin/logo.png');
  assert.equal(getLogoUrl('https://cdn.example.com/custom-logo.png'), 'https://cdn.example.com/custom-logo.png');
  assert.deepEqual(getEditionConfig('admin').allowedDemoTiers, ['super_admin', 'stage_leader']);

  mockStorage.setItem('userRole', 'class_servant');
  mockStorage.setItem('currentSyncKey', 'رابعة ابتدائي');
  mockStorage.setItem('currentServant', JSON.stringify(accounts[2]));
  assert.equal(resolveUserAccessScope(settings).isGuest, true, 'admin edition must reject class_servant login');

  mockStorage.setItem('userRole', 'super_admin');
  mockStorage.setItem('currentSyncKey', 'MASTER_ACCESS');
  mockStorage.setItem('currentServant', JSON.stringify(accounts[0]));
  assert.equal(resolveUserAccessScope(settings).roleTier, 'super_admin');

  // servant edition allows class_servant, blocks admin & stage_leader & parent
  mockStorage.setItem(DEMO_EDITION_OVERRIDE_KEY, 'servant');
  assert.equal(getAppEdition(), 'servant');
  assert.equal(getLogoUrl('/logo.png'), '/editions/servant/logo.png');
  assert.deepEqual(getEditionConfig('servant').allowedDemoTiers, ['class_servant']);
  assert.equal(resolveUserAccessScope(settings).isGuest, true, 'servant edition must reject super_admin');

  mockStorage.setItem('userRole', 'class_servant');
  mockStorage.setItem('currentSyncKey', 'رابعة ابتدائي');
  mockStorage.setItem('currentServant', JSON.stringify(accounts[2]));
  const servantEdScope = resolveUserAccessScope(settings);
  assert.equal(servantEdScope.roleTier, 'class_servant');
  assert.equal(servantEdScope.canAccessSystemAdmin, false);
  assert.equal(servantEdScope.canAccessMasterDashboard, false);

  // parent edition allows parent only, blocks servant/admin sessions
  mockStorage.setItem(DEMO_EDITION_OVERRIDE_KEY, 'parent');
  assert.equal(getAppEdition(), 'parent');
  assert.equal(getLogoUrl('/logo.png'), '/editions/parent/logo.png');
  assert.equal(resolveUserAccessScope(settings).isGuest, true, 'parent edition must reject servant session');

  mockStorage.clear();
  mockStorage.setItem(DEMO_EDITION_OVERRIDE_KEY, 'parent');
  mockStorage.setItem('userRole', 'parent');
  mockStorage.setItem('parentChildId', 'demo_kg2_1');
  assert.equal(resolveUserAccessScope(settings).roleTier, 'parent');
 } finally {
  if (prevLocalStorage === undefined) {
   delete globalThis.localStorage;
  } else {
   Object.defineProperty(globalThis, 'localStorage', { value: prevLocalStorage, configurable: true, writable: true });
  }
  if (prevWindow === undefined) {
   delete globalThis.window;
  } else {
   Object.defineProperty(globalThis, 'window', { value: prevWindow, configurable: true, writable: true });
  }
 }
});

test('canonical child identity binds syncKey, unique id==cloudId, class-scoped BRS qrId, and rejects sentinel keys', () => {
 assert.throws(() => createCanonicalChildRecord({ name: 'بيتر سامي' }, ''), /syncKey/);
 assert.throws(() => createCanonicalChildRecord({ name: 'بيتر سامي' }, 'MASTER_ACCESS'), /syncKey/);
 assert.throws(() => createCanonicalChildRecord({ name: 'بيتر سامي' }, 'ADMIN_MODE'), /syncKey/);
 assert.throws(() => createCanonicalChildRecord({ name: 'بيتر سامي' }, 'STAGE_ADMIN'), /syncKey/);

 const recA = createCanonicalChildRecord({ name: '  أبانوب عياد  ', confessionFather: 'أبونا بولس' }, 'رابعة ابتدائي');
 assert.ok(recA.id.startsWith('ch_'));
 assert.equal(recA.id, recA.cloudId);
 assert.equal(recA.syncKey, 'رابعة ابتدائي');
 assert.match(recA.qrId, /^BRS-[A-Z0-9]+-[A-Z0-9]+$/);
 assert.equal(recA.fatherConfessor, 'أبونا بولس');
 assert.equal(recA.confessionFather, 'أبونا بولس');

 const qrOverride = generateClassScopedQrId('رابعة ابتدائي', 'BRS-CUSTOM-1234');
 assert.equal(qrOverride, 'BRS-CUSTOM-1234');
});

test('mergeChildRecordsPreservingPhoto retains Cloudinary or local avatar against newer blank cloud payloads', () => {
 const localChild = {
  id: 'ch_100',
  cloudId: 'ch_100',
  syncKey: 'خامسة ابتدائي',
  name: 'مارك جرجس',
  profilePic: 'https://res.cloudinary.com/dqsmwgha/image/upload/v1/st-barsoum/avatar.jpg',
  qrId: 'BRS-5A-9012',
  updatedAt: 1000,
  isDirty: false
 };
 const newerCloudBlankPhoto = {
  id: 'ch_100',
  cloudId: 'ch_100',
  syncKey: 'خامسة ابتدائي',
  name: 'مارك جرجس كامل',
  profilePic: '',
  updatedAt: 2000
 };
 const merged = mergeChildRecordsPreservingPhoto(localChild, newerCloudBlankPhoto);
 assert.equal(merged.name, 'مارك جرجس كامل');
 assert.equal(merged.profilePic, localChild.profilePic);
 assert.equal(merged.qrId, 'BRS-5A-9012');
 assert.equal(merged.isDeleted, false);
});

test('Excel template schema, monthly filename format, and 2-sheet comprehensive class workbook builder', () => {
 assert.equal(BLANK_CLASS_TEMPLATE_HEADERS.length, 11);
 const sampleRow = buildBlankClassTemplateSampleRow('رابعة ابتدائي');
 for (const header of BLANK_CLASS_TEMPLATE_HEADERS) {
  assert.ok(Object.prototype.hasOwnProperty.call(sampleRow, header), `Missing sample key: ${header}`);
 }

 const filename = formatClassMonthlyExcelFilename('فصل الأنبا موسى (إعدادي)', new Date(2026, 10, 15));
 assert.equal(filename, 'بيانات_وغياب_فصل_الأنبا_موسى_(إعدادي)_شهر_نوفمبر_2026.xlsx');

 const canonical = createCanonicalChildRecord({ name: 'كيرلس هاني', gender: 'ولد', qrId: 'BRS-K-111' }, 'إعدادي بنين');
 const workbookData = buildClassExcelExportRows({
  children: [canonical],
  attendance: [
   { childId: canonical.id, syncKey: 'إعدادي بنين', date: '2026-11-06', type: 'service', status: 'present', updatedAt: 10 },
   { childId: canonical.id, syncKey: 'إعدادي بنين', date: '2026-11-08', type: 'liturgy', present: true, updatedAt: 11 }
  ],
  pointsLogs: [
   { id: 'pt-1', childId: canonical.id, syncKey: 'إعدادي بنين', monthKey: '2026-11', category: 'attendance', points: 10, updatedAt: 12 }
  ],
  services: [{ name: 'خدمة إعدادي', osras: [{ name: 'إعدادي بنين', syncKey: 'إعدادي بنين' }] }],
  refDate: new Date(2026, 10, 15),
  allowedSyncKeys: ['إعدادي بنين']
 });

 assert.equal(workbookData.activeCount, 1);
 assert.equal(workbookData.sheet1Rows.length, 1);
 assert.equal(workbookData.sheet1Rows[0]['كود الـ QR الخاص'], 'BRS-K-111');
 assert.equal(workbookData.sheet1Rows[0]['حضور الخدمة (الشهر الحالي)'], 1);
 assert.equal(workbookData.sheet1Rows[0]['حضور القداس (الشهر الحالي)'], 1);
 assert.equal(workbookData.sheet1Rows[0]['نقاط الشهر الحالي'], 10);
 assert.equal(workbookData.sheet2Rows.length, 2);
});

test('sanitizeAuthorizedServants & sanitizeChurchServices purge legacy Kinonia leaks and deacon fields are stripped', async () => {
 const {
  sanitizeAuthorizedServants,
  sanitizeChurchServices,
  OFFICIAL_ST_BARSOUM_SERVANTS
 } = await import('../src/utils/churchStructureSanitizer.js');
 const { DEFAULT_CHURCH_SERVICES } = await import('../src/utils/notificationScopeEngine.js');

 const cleanServices = sanitizeChurchServices([
  ...DEFAULT_CHURCH_SERVICES,
  { name: 'كنيونيا', osras: [{ name: 'فصل الشهيد زكريا', syncKey: 'zekrya' }] }
 ], DEFAULT_CHURCH_SERVICES);
 assert.ok(!cleanServices.some((s) => JSON.stringify(s).includes('الشهيد زكريا')));

 const dirtyServants = [
  { id: 'kin_1', name: 'Bavly Aziz', phone: '0120000111', syncKey: 'MASTER_ACCESS', assignedOsra: 'كل الأسر' },
  { id: 'kin_2', name: 'متياس بسيط سمعان', phone: '0120000222', syncKey: 'zekrya', assignedOsra: 'فصل الشهيد زكريا' },
  { id: 'kin_3', name: 'سيلفيا ايمن لويز', phone: '0120000333', syncKey: 'الانبا كاراس', assignedOsra: 'فصل الانبا كاراس' },
  { id: 'valid_1', name: 'خادم معتمد', phone: '01234567890', syncKey: 'رابعة ابتدائي', assignedOsra: 'رابعة ابتدائي' }
 ];
 const sanitized = sanitizeAuthorizedServants(dirtyServants, cleanServices, { fallbackToOfficial: true });
 assert.equal(sanitized.length, 1);
 assert.equal(sanitized[0].name, 'خادم معتمد');

 const fallbackServants = sanitizeAuthorizedServants(dirtyServants.slice(0, 3), cleanServices, { fallbackToOfficial: true });
 assert.equal(fallbackServants.length, OFFICIAL_ST_BARSOUM_SERVANTS.length);

 const canonical = createCanonicalChildRecord({
  name: 'بيشوي عماد',
  academicYear: 'رابعة ابتدائي',
  isOrdained: true,
  ordinationRank: 'إبصالتس'
 }, 'رابعة ابتدائي');
 assert.equal(canonical.academicYear, 'رابعة ابتدائي');
 assert.equal('isOrdained' in canonical, false);
 assert.equal('ordinationRank' in canonical, false);
});

test('Scoped storage helpers isolate tenant keys and purge unscoped legacy collisions in browser mode', async () => {
 const {
  readScopedStorage,
  writeScopedStorage,
  removeScopedStorage,
  purgeLegacyUnscopedBrowserStorage,
  getScopedStorageKey
 } = await import('../src/utils/tenantConfig.js');

 const prevDocument = globalThis.document;
 const store = new Map([
  ['appSettings', JSON.stringify({ servants: [{ name: 'Bavly Aziz' }] })],
  ['currentServant', JSON.stringify({ name: 'Bavly Aziz' })]
 ]);
 const mockLs = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(String(k), String(v)); },
  removeItem: (k) => { store.delete(String(k)); },
  clear: () => { store.clear(); }
 };
 Object.defineProperty(globalThis, 'window', { value: { localStorage: mockLs }, configurable: true, writable: true });
 Object.defineProperty(globalThis, 'localStorage', { value: mockLs, configurable: true, writable: true });
 Object.defineProperty(globalThis, 'document', { value: {}, configurable: true, writable: true });

 try {
  purgeLegacyUnscopedBrowserStorage();
  assert.equal(store.has('appSettings'), false);
  assert.equal(store.has('currentServant'), false);

  writeScopedStorage('currentSyncKey', 'رابعة ابتدائي');
  assert.equal(store.get(getScopedStorageKey('currentSyncKey')), 'رابعة ابتدائي');
  assert.equal(store.has('currentSyncKey'), false);
  assert.equal(readScopedStorage('currentSyncKey'), 'رابعة ابتدائي');

  removeScopedStorage('currentSyncKey');
  assert.equal(readScopedStorage('currentSyncKey'), null);
 } finally {
  if (prevDocument === undefined) delete globalThis.document;
  else Object.defineProperty(globalThis, 'document', { value: prevDocument, configurable: true, writable: true });
 }
});

test('Messaging engine parses videos, filters role audiences, formats zero-emoji WhatsApp links, and routes visibility', async () => {
 const {
  parseVideoEmbedUrl,
  formatBroadcastWhatsappText,
  buildWhatsappDirectLink,
  getAudienceScopeOptions,
  resolveTargetRecipients,
  isMessageVisibleToServant,
  isMessageVisibleInHomeHub,
  isMessageVisibleToChild,
  canCurrentUserDeleteMessage,
  markMessageTombstone,
  isMessageTombstoned,
  isDemoOrFakeMessage
 } = await import('../src/utils/messagingEngine.js');

 const yt = parseVideoEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
 assert.equal(yt.type, 'iframe');
 assert.equal(yt.provider, 'youtube');
 assert.ok(yt.embedUrl.includes('youtube.com/embed/dQw4w9WgXcQ'));

 const drive = parseVideoEmbedUrl('https://drive.google.com/file/d/abc123XYZ/view');
 assert.equal(drive.type, 'iframe');
 assert.equal(drive.provider, 'drive');

 const mp4 = parseVideoEmbedUrl('https://res.cloudinary.com/demo/video/upload/v1/sample.mp4');
 assert.equal(mp4.type, 'video');

 const adminOpts = getAudienceScopeOptions({ isSuperAdmin: true, isImpersonating: false });
 assert.ok(adminOpts.some(o => o.scopeKind === 'all_servants'));
 assert.ok(adminOpts.some(o => o.scopeKind === 'all_children'));

 const leaderOpts = getAudienceScopeOptions({ isStageLeader: true, stageName: 'مجموعة مدارس الأحد', isImpersonating: false });
 assert.ok(leaderOpts.every(o => o.scopeKind !== 'all_servants' && o.scopeKind !== 'all_children'));

 const servantOpts = getAudienceScopeOptions({ isClassServant: true, activeSyncKey: 'رابعة ابتدائي' }, 'رابعة ابتدائي');
 assert.equal(servantOpts.length, 1);
 assert.equal(servantOpts[0].fixedSyncKey, 'رابعة ابتدائي');

 const recipients = resolveTargetRecipients({
  targetType: 'children',
  scopeKind: 'class_children',
  targetSyncKey: 'رابعة ابتدائي',
  children: [
   { id: 'c1', name: 'أبانوب عماد', syncKey: 'رابعة ابتدائي', motherPhone: '01200001111', whatsappTarget: 'mother' },
   { id: 'c2', name: 'مارك هاني', syncKey: 'خامسة ابتدائي', motherPhone: '01200002222', whatsappTarget: 'mother' }
  ]
 });
 assert.equal(recipients.length, 1);
 assert.equal(recipients[0].id, 'c1');

 const waText = formatBroadcastWhatsappText({
  title: 'تنبيه هام',
  body: 'اجتماع غداً الساعة 5',
  videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
  linkUrl: 'https://example.com'
 }, 'أبانوب');
 assert.ok(waText.includes('أبانوب'));
 assert.equal(/\p{Extended_Pictographic}/gu.test(waText), false);
 assert.ok(buildWhatsappDirectLink('01200001111', waText).includes('phone=201200001111'));

 assert.equal(
  isMessageVisibleToServant({ targetType: 'servants', scopeKind: 'all_servants' }, { allowedSyncKeys: ['رابعة ابتدائي'] }, {}),
  true
 );
 assert.equal(
  isMessageVisibleToServant({ targetType: 'servants', scopeKind: 'class_servants', targetSyncKey: 'إعدادي بنين' }, { allowedSyncKeys: ['رابعة ابتدائي'] }, {}),
  false
 );
 assert.equal(
  isMessageVisibleToChild({ targetType: 'children', scopeKind: 'class_children', targetSyncKey: 'كي جي 2' }, 'كي جي 2', []),
  true
 );
 assert.equal(
  isMessageVisibleToChild({ targetType: 'children', scopeKind: 'class_children', targetSyncKey: 'إعدادي بنين' }, 'كي جي 2', []),
  false
 );

 // 1) Servant Home Hub sees BOTH incoming servant announcements AND messages sent to their class children
 const classSentMsg = { id: 'msg_live_1', targetType: 'children', scopeKind: 'class_children', targetSyncKey: 'رابعة ابتدائي', senderName: 'أ. بيشوي' };
 assert.equal(
  isMessageVisibleInHomeHub(classSentMsg, { isClassServant: true, activeSyncKey: 'رابعة ابتدائي' }, { syncKey: 'رابعة ابتدائي' }, []),
  true
 );
 assert.equal(
  isMessageVisibleInHomeHub(classSentMsg, { isClassServant: true, activeSyncKey: 'إعدادي بنين' }, { syncKey: 'إعدادي بنين' }, []),
  false
 );

 // 2) Delete permissions enforce RBAC
 assert.equal(canCurrentUserDeleteMessage(classSentMsg, { isClassServant: true, activeSyncKey: 'رابعة ابتدائي' }, {}), true);
 assert.equal(
  canCurrentUserDeleteMessage({ id: 'msg_srv_global', targetType: 'servants', scopeKind: 'all_servants', senderName: 'أبونا بولس' }, { isClassServant: true, activeSyncKey: 'رابعة ابتدائي' }, { name: 'خادم' }),
  false
 );

 // 3) Tombstone & fake demo guards prevent deleted or fake messages from resurfacing
 markMessageTombstone('msg_deleted_forever_1');
 assert.equal(isMessageTombstoned('msg_deleted_forever_1'), true);
 assert.equal(
  isMessageVisibleToChild({ id: 'msg_deleted_forever_1', targetType: 'children', scopeKind: 'all_children' }, 'كي جي 2', []),
  false
 );
 assert.equal(isDemoOrFakeMessage({ id: 'msg_demo_old_1' }), true);
 assert.equal(
  isMessageVisibleInHomeHub({ id: 'msg_demo_old_1', targetType: 'servants', scopeKind: 'all_servants' }, { isSuperAdmin: true }, {}, []),
  false
 );

 // 4) Merging servants + class/stage leaders from services in resolveTargetRecipients
 const srvRecipients = resolveTargetRecipients({
  targetType: 'servants',
  scopeKind: 'all_servants',
  servants: [{ id: 's1', name: 'خادم 1', phone: '01200003333', syncKey: 'رابعة ابتدائي' }],
  services: [{ name: 'مجموعة مدارس الأحد', osras: [{ syncKey: 'كي جي 1', name: 'كي جي 1', leaderName: 'أمينة كي جي', leaderPhone: '01200004444' }] }]
 });
 assert.equal(srvRecipients.length, 2);
});

test('Dynamic schedule builder generates custom weekly sessions, preserves multi-day attendance without collision, and deduplicates incoming message notifications', async () => {
 const {
  getClassScheduleConfig,
  getClassWeeklySessions,
  buildScheduleLabel,
  getElapsedServiceDatesForClass
 } = await import('../src/utils/serviceWeek.js');
 const { buildClassExcelExportRows } = await import('../src/utils/excelClassHelpers.js');
 const { shouldNotifyForIncomingMessage, markMessagesAsNotified } = await import('../src/utils/messagingEngine.js');
 const { buildIncomingMessageNotificationPayload } = await import('../src/utils/pwaNotificationService.js');

 // 1. Custom class with serviceDays ['tuesday', 'saturday'] and liturgyDays ['sunday']
 const customAppSettings = {
  services: [
   {
    id: 99,
    name: 'خدمة جديدة مخصصة',
    serviceDays: ['tuesday', 'saturday'],
    liturgyDays: ['sunday'],
    osras: [
     {
      id: 991,
      name: 'فصل مخصص جديد',
      syncKey: 'custom_class_991',
      serviceDays: ['tuesday', 'saturday'],
      liturgyDays: ['sunday'],
      useCustomSchedule: true
     }
    ]
   }
  ]
 };

 const refDate = new Date('2026-11-19T12:00:00'); // Thursday start of week (2026-11-19 .. 2026-11-25)
 const cfg = getClassScheduleConfig('custom_class_991', 'فصل مخصص جديد', customAppSettings);
 assert.deepEqual(cfg.serviceDays, ['tuesday', 'saturday']);
 assert.deepEqual(cfg.liturgyDays, ['sunday']);
 assert.equal(buildScheduleLabel(['tuesday', 'saturday'], ['sunday']), 'الثلاثاء والسبت • قداس الأحد');

 const sessions = getClassWeeklySessions('custom_class_991', customAppSettings, refDate);
 assert.equal(sessions.length, 3);
 assert.ok(sessions.some(s => s.id === 'service_tuesday' && s.label === 'خدمة الثلاثاء' && s.date === '2026-11-24'));
 assert.ok(sessions.some(s => s.id === 'service_saturday' && s.label === 'خدمة السبت' && s.date === '2026-11-21'));
 assert.ok(sessions.some(s => s.id === 'liturgy_sunday' && s.label === 'قداس الأحد' && s.date === '2026-11-22'));

 // Distinct dates mean zero collision across weekly sessions
 const uniqueDateTypes = new Set(sessions.map(s => `${s.date}::${s.type}`));
 assert.equal(uniqueDateTypes.size, 3);

 // Explicit empty liturgyDays: [] removes default Friday liturgy
 const noLiturgySessions = getClassWeeklySessions({
  syncKey: 'youth_no_liturgy',
  name: 'اجتماع بدون قداس',
  serviceDays: ['monday', 'friday'],
  liturgyDays: []
 }, null, refDate);
 assert.equal(noLiturgySessions.length, 2);
 assert.ok(noLiturgySessions.every(s => s.type === 'service'));

 // 2. Recording Day 1 (Sunday) and Day 2 (Thursday) for the SAME child in the SAME week yields 2 distinct service attendances
 const elapsed = getElapsedServiceDatesForClass('2026-11-19', '2026-11-25', {
  syncKey: 'رابعة ابتدائي',
  className: 'رابعة ابتدائي',
  todayStr: '2026-11-25'
 });
 assert.ok(elapsed.includes('2026-11-19')); // Thursday
 assert.ok(elapsed.includes('2026-11-22')); // Sunday

 const excelMulti = buildClassExcelExportRows({
  children: [{ id: 'child_1', name: 'كاراس بيشوي', syncKey: 'رابعة ابتدائي', isDeleted: false }],
  attendance: [
   { id: 1, childId: 'child_1', syncKey: 'رابعة ابتدائي', date: '2026-11-19', type: 'service', status: 'present', updatedAt: '2026-11-19T10:00:00Z' },
   { id: 2, childId: 'child_1', syncKey: 'رابعة ابتدائي', date: '2026-11-22', type: 'service', status: 'present', updatedAt: '2026-11-22T10:00:00Z' }
  ],
  refDate: new Date('2026-11-22T12:00:00'),
  allowedSyncKeys: ['رابعة ابتدائي']
 });
 assert.equal(excelMulti.sheet1Rows[0]['حضور الخدمة (الشهر الحالي)'], 2);
 assert.equal(excelMulti.sheet1Rows[0]['إجمالي حضور الخدمة'], 2);

 // 3. Incoming new message triggers notification exactly once per msg.id and respects initial-boot & self-send guards
 const nowMs = Date.now();
 const freshMsg = {
  id: 'msg_incoming_test_99',
  title: 'رسالة افتقاد هامة',
  body: 'موعد التسبحة غداً',
  imageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/sample.jpg',
  senderName: 'أبونا بولس',
  senderDeviceId: 'dev_remote_other',
  createdAt: new Date(nowMs - 2000).toISOString()
 };
 const seenSet = new Set();
 assert.equal(shouldNotifyForIncomingMessage(freshMsg, { nowMs, seenIds: seenSet, currentDeviceId: 'dev_local_me', skipInitial: true }), false);
 assert.equal(shouldNotifyForIncomingMessage(freshMsg, { nowMs, seenIds: seenSet, currentDeviceId: 'dev_remote_other', skipInitial: false }), false);
 assert.equal(shouldNotifyForIncomingMessage(freshMsg, { nowMs, seenIds: seenSet, currentDeviceId: 'dev_local_me', skipInitial: false }), true);

 markMessagesAsNotified([freshMsg.id]);
 seenSet.add(freshMsg.id);
 assert.equal(shouldNotifyForIncomingMessage(freshMsg, { nowMs, seenIds: seenSet, currentDeviceId: 'dev_local_me', skipInitial: false }), false);

 const notifPayload = buildIncomingMessageNotificationPayload(freshMsg, { id: 'parent' });
 assert.equal(notifPayload.options.icon, '/editions/parent/pwa-192x192.png');
 assert.equal(notifPayload.options.badge, '/editions/parent/pwa-192x192.png');
 assert.equal(notifPayload.options.image, freshMsg.imageUrl);
 assert.equal(notifPayload.options.tag, `msg_${freshMsg.id}`);
 assert.deepEqual(notifPayload.options.vibrate, [200, 100, 200]);
 assert.equal(/\p{Extended_Pictographic}/gu.test(notifPayload.title + notifPayload.options.body), false);
});

test('Coptic Year PDF indexer and resolveCurrentBookProgression advance sequentially (Week 1 -> Week 2 -> Month 2 -> Part 2) without affecting manual curricula', async () => {
 const {
  resolveCurrentBookProgression,
  getOsraCurricula,
  getOsraCopticBookPlans,
  isPdfCurriculumItem,
  isCopticBookPlanItem
 } = await import('../src/utils/curriculumEngine.js');
 const { extractLessonsFromPagesText } = await import('../src/utils/pdfCurriculumIndexer.js');

 // 1. Verify Arabic weekly markers extraction & page range calculation
 const samplePages = [
  ['غلاف الكتاب - الجزء الثالث'],
  ['الأسبوع الأول من شهر بشنس', 'إبراهيم والوعد بإسحق'],
  ['تكملة الدرس الأول'],
  ['الأسبوع الثاني من شهر بشنس', 'معمودية ربنا يسوع المسيح']
 ];
 const extracted = extractLessonsFromPagesText(samplePages, 3);
 assert.equal(extracted.partNumber, 3);
 assert.deepEqual(extracted.copticMonths, ['بشنس', 'بؤونة', 'أبيب', 'مسرى']);
 assert.equal(extracted.lessons.length, 16);
 assert.equal(extracted.lessons[0].copticMonth, 'بشنس');
 assert.equal(extracted.lessons[0].weekNumber, 1);
 assert.equal(extracted.lessons[0].title, 'إبراهيم والوعد بإسحق');
 assert.equal(extracted.lessons[0].startPage, 2);
 assert.equal(extracted.lessons[0].endPage, 3);
 assert.equal(extracted.lessons[1].title, 'معمودية ربنا يسوع المسيح');
 assert.equal(extracted.lessons[1].startPage, 4);

 // 2. Verify sequential progression: Week 1 -> Week 2 -> Month 2 -> Part 2
 const part1Book = {
  id: 'book_first_primary_part1',
  itemType: 'coptic_book_plan',
  syncKey: 'أولى ابتدائي',
  title: 'منهج أولى ابتدائي - الجزء الأول',
  partNumber: 1,
  partLabel: 'الجزء الأول (توت - بابه)',
  fileUrl: 'https://res.cloudinary.com/demo/image/upload/v1/part1.pdf',
  totalPages: 40,
  lessons: [
   { id: 'p1_m1_w1', copticMonth: 'توت', monthOrder: 1, weekNumber: 1, weekLabel: 'الأسبوع الأول', title: 'درس توت 1', startPage: 3, endPage: 8, isCompleted: false },
   { id: 'p1_m1_w2', copticMonth: 'توت', monthOrder: 1, weekNumber: 2, weekLabel: 'الأسبوع الثاني', title: 'درس توت 2', startPage: 9, endPage: 15, isCompleted: false },
   { id: 'p1_m2_w1', copticMonth: 'بابه', monthOrder: 2, weekNumber: 1, weekLabel: 'الأسبوع الأول', title: 'درس بابه 1', startPage: 16, endPage: 22, isCompleted: false }
  ]
 };
 const part2Book = {
  id: 'book_first_primary_part2',
  itemType: 'coptic_book_plan',
  syncKey: 'أولى ابتدائي',
  title: 'منهج أولى ابتدائي - الجزء الثاني',
  partNumber: 2,
  partLabel: 'الجزء الثاني (طوبة - أمشير)',
  fileUrl: 'https://res.cloudinary.com/demo/image/upload/v1/part2.pdf',
  totalPages: 45,
  lessons: [
   { id: 'p2_m1_w1', copticMonth: 'طوبة', monthOrder: 1, weekNumber: 1, weekLabel: 'الأسبوع الأول', title: 'درس طوبة 1', startPage: 5, endPage: 12, isCompleted: false }
  ]
 };

 // Initial state -> Week 1 of Month 1 (توت) in Part 1 is active
 let prog = resolveCurrentBookProgression([part2Book, part1Book]);
 assert.equal(prog.currentActiveLesson.id, 'p1_m1_w1');
 assert.equal(prog.activePartNumber, 1);
 assert.equal(prog.activeCopticMonth, 'توت');

 // Stamp Week 1 -> advances to Week 2 of Month 1 (توت)
 part1Book.lessons[0].isCompleted = true;
 prog = resolveCurrentBookProgression([part2Book, part1Book]);
 assert.equal(prog.currentActiveLesson.id, 'p1_m1_w2');
 assert.equal(prog.parts[0].months[0].isMonthCompleted, false);

 // Stamp Week 2 -> Month 1 (توت) closes with green seal, advances to Month 2 (بابه) Week 1
 part1Book.lessons[1].isCompleted = true;
 prog = resolveCurrentBookProgression([part2Book, part1Book]);
 assert.equal(prog.parts[0].months[0].isMonthCompleted, true);
 assert.equal(prog.currentActiveLesson.id, 'p1_m2_w1');
 assert.equal(prog.activeCopticMonth, 'بابه');

 // Stamp Month 2 Week 1 -> Part 1 closes with green seal, automatically advances to Part 2 Week 1 (طوبة)!
 part1Book.lessons[2].isCompleted = true;
 prog = resolveCurrentBookProgression([part2Book, part1Book]);
 assert.equal(prog.parts[0].isPartCompleted, true);
 assert.equal(prog.currentActiveLesson.id, 'p2_m1_w1');
 assert.equal(prog.activePartNumber, 2);
 assert.equal(prog.activeCopticMonth, 'طوبة');

 // 3. Verify manual lessons and PDFs remain 100% isolated and unaffected
 const manualLesson = {
  id: 'manual_lesson_1',
  syncKey: 'أولى ابتدائي',
  itemType: 'lesson',
  category: 'درس كتاب مقدس وعقيدة',
  title: 'درس يدوي مضاف من الخادم'
 };
 const manualPdf = {
  id: 'manual_pdf_1',
  syncKey: 'أولى ابتدائي',
  itemType: 'pdf',
  category: 'ملف PDF / مذكرة',
  title: 'مذكرة الألحان PDF',
  fileUrl: 'https://res.cloudinary.com/demo/raw/upload/v1/hymns.pdf'
 };
 const allUnified = getOsraCurricula('أولى ابتدائي', [part1Book, part2Book, manualLesson, manualPdf], []);
 const bookPlansOnly = getOsraCopticBookPlans('أولى ابتدائي', [part1Book, part2Book, manualLesson, manualPdf], []);
 const manualPdfsOnly = allUnified.filter(item => isPdfCurriculumItem(item));
 const manualLessonsOnly = allUnified.filter(item => !isPdfCurriculumItem(item) && !isCopticBookPlanItem(item));

 assert.equal(bookPlansOnly.length, 2);
 assert.equal(manualPdfsOnly.length, 1);
 assert.equal(manualPdfsOnly[0].id, 'manual_pdf_1');
 assert.ok(manualLessonsOnly.some(l => l.id === 'manual_lesson_1'));
 assert.ok(!manualLessonsOnly.some(l => isCopticBookPlanItem(l)));

 // 4. Verify Cloudinary 9.8 MB PDF client-side size guard
 const { validateCloudinaryPdfSize } = await import('../src/utils/cloudinary.js');
 const okSize = validateCloudinaryPdfSize({ size: 6.5 * 1024 * 1024 });
 assert.equal(okSize.ok, true);
 const tooBig = validateCloudinaryPdfSize({ size: 12.4 * 1024 * 1024 });
 assert.equal(tooBig.ok, false);
 assert.ok(tooBig.message.includes('12.4') && tooBig.message.includes('10 ميجابايت'));
});


test('resolveMultiTrackBookProgression tracks 2+ annual curricula independently in the same class and zero demo data is seeded on fresh boot', async () => {
 await reset();
 const {
  resolveMultiTrackBookProgression,
  resolveCurrentBookProgression,
  normalizeCurriculumTrack,
  hydrateServicesWithCurricula
 } = await import('../src/utils/curriculumEngine.js');
 const { ensureDemoDataSeeded, activateDemoAccountSession } = await import('../src/utils/demoSeeder.js');
 const { sanitizeAuthorizedServants, sanitizeChurchServices } = await import('../src/utils/churchStructureSanitizer.js');
 const { compressPdfInBrowser } = await import('../src/utils/pdfCurriculumIndexer.js');
 const { PDFDocument } = await import('pdf-lib');

 // 1. Verify ZERO demo data is seeded on fresh boot in production mode
 await db.children.clear();
 await db.attendance.clear();
 await db.grades.clear();
 const didSeed = await ensureDemoDataSeeded(true);
 assert.equal(didSeed, false, 'ensureDemoDataSeeded must never seed fake records in production');
 assert.equal((await db.children.toArray()).length, 0);
 assert.equal((await db.attendance.toArray()).length, 0);
 assert.equal((await db.grades.toArray()).length, 0);
 assert.equal(await activateDemoAccountSession({ tierKey: 'super_admin' }), '/login');

 // Clean production defaults: empty services -> [], empty/demo servants -> []
 assert.deepEqual(sanitizeChurchServices([], []), []);
 assert.deepEqual(
  sanitizeAuthorizedServants(
   [{ id: 'srv_demo_priest', name: 'أبونا راعي الكنيسة (تجريبي)', syncKey: 'MASTER_ACCESS' }],
   []
  ),
  []
 );
 const emptyClassHydrated = hydrateServicesWithCurricula([
  { id: 's1', name: 'خدمة ابتدائى', osras: [{ id: 'o1', name: 'أولى ابتدائي', syncKey: 'أولى ابتدائي', curricula: [] }] }
 ]);
 assert.equal(emptyClassHydrated[0].osras[0].curricula.length, 0, 'Production classes must start with 0 fake curricula');

 // 2. Verify Multi-Track Annual Curricula (track_1 & track_2) advance 100% independently in the same class
 const track1Part1 = {
  id: 'book_p1_track1_part1',
  itemType: 'coptic_book_plan',
  syncKey: 'رابعة ابتدائي',
  trackId: 'track_1',
  trackName: 'منهج التربية الكنسية',
  title: 'منهج التربية الكنسية - الجزء الأول',
  partNumber: 1,
  partLabel: 'الجزء الأول (توت - بابه)',
  fileUrl: 'https://res.cloudinary.com/demo/image/upload/v1/t1_p1.pdf',
  totalPages: 40,
  lessons: [
   { id: 't1_p1_m1_w1', copticMonth: 'توت', monthOrder: 1, weekNumber: 1, weekLabel: 'الأسبوع الأول', title: 'درس التربية 1', startPage: 3, endPage: 8, isCompleted: false },
   { id: 't1_p1_m1_w2', copticMonth: 'توت', monthOrder: 1, weekNumber: 2, weekLabel: 'الأسبوع الثاني', title: 'درس التربية 2', startPage: 9, endPage: 14, isCompleted: false },
   { id: 't1_p1_m2_w1', copticMonth: 'بابه', monthOrder: 2, weekNumber: 1, weekLabel: 'الأسبوع الأول', title: 'درس التربية بابه', startPage: 15, endPage: 20, isCompleted: false }
  ]
 };
 const track1Part2 = {
  id: 'book_p1_track1_part2',
  itemType: 'coptic_book_plan',
  syncKey: 'رابعة ابتدائي',
  trackId: 'track_1',
  trackName: 'منهج التربية الكنسية',
  title: 'منهج التربية الكنسية - الجزء الثاني',
  partNumber: 2,
  partLabel: 'الجزء الثاني (طوبة - أمشير)',
  fileUrl: 'https://res.cloudinary.com/demo/image/upload/v1/t1_p2.pdf',
  totalPages: 36,
  lessons: [
   { id: 't1_p2_m1_w1', copticMonth: 'طوبة', monthOrder: 1, weekNumber: 1, weekLabel: 'الأسبوع الأول', title: 'درس التربية طوبة', startPage: 4, endPage: 10, isCompleted: false }
  ]
 };
 const track2Part1 = {
  id: 'book_p1_track2_part1',
  itemType: 'coptic_book_plan',
  syncKey: 'رابعة ابتدائي',
  trackId: 'track_2',
  trackName: 'منهج الكتاب المقدس والطقس',
  title: 'منهج الكتاب المقدس والطقس - الجزء الأول',
  partNumber: 1,
  partLabel: 'الجزء الأول (توت - كيهك)',
  fileUrl: 'https://res.cloudinary.com/demo/image/upload/v1/t2_p1.pdf',
  totalPages: 50,
  lessons: [
   { id: 't2_p1_m1_w1', copticMonth: 'توت', monthOrder: 1, weekNumber: 1, weekLabel: 'الأسبوع الأول', title: 'طقس رفع بخور باكر', startPage: 5, endPage: 12, isCompleted: false },
   { id: 't2_p1_m1_w2', copticMonth: 'توت', monthOrder: 1, weekNumber: 2, weekLabel: 'الأسبوع الثاني', title: 'أسفار الشريعة', startPage: 13, endPage: 20, isCompleted: false }
  ]
 };

 const combinedClassBooks = [track2Part1, track1Part2, track1Part1];
 let tracks = resolveMultiTrackBookProgression(combinedClassBooks);
 assert.equal(tracks.length, 2);
 assert.equal(tracks[0].trackId, 'track_1');
 assert.equal(tracks[0].trackName, 'منهج التربية الكنسية');
 assert.equal(tracks[0].currentActiveLesson.id, 't1_p1_m1_w1');
 assert.equal(tracks[0].completedCount, 0);
 assert.equal(tracks[0].totalCount, 4);

 assert.equal(tracks[1].trackId, 'track_2');
 assert.equal(tracks[1].trackName, 'منهج الكتاب المقدس والطقس');
 assert.equal(tracks[1].currentActiveLesson.id, 't2_p1_m1_w1');
 assert.equal(tracks[1].completedCount, 0);
 assert.equal(tracks[1].totalCount, 2);

 // Advance Track 1 all the way through Week 1 -> Week 2 -> Month 2 -> Part 2; Track 2 MUST stay untouched on Week 1!
 track1Part1.lessons[0].isCompleted = true;
 tracks = resolveMultiTrackBookProgression(combinedClassBooks);
 assert.equal(tracks[0].currentActiveLesson.id, 't1_p1_m1_w2');
 assert.equal(tracks[0].completedCount, 1);
 assert.equal(tracks[1].currentActiveLesson.id, 't2_p1_m1_w1', 'Track 2 active lesson must not move when Track 1 is stamped');
 assert.equal(tracks[1].completedCount, 0);

 track1Part1.lessons[1].isCompleted = true;
 track1Part1.lessons[2].isCompleted = true;
 tracks = resolveMultiTrackBookProgression(combinedClassBooks);
 assert.equal(tracks[0].parts[0].isPartCompleted, true);
 assert.equal(tracks[0].activePartNumber, 2);
 assert.equal(tracks[0].currentActiveLesson.id, 't1_p2_m1_w1');
 assert.equal(tracks[0].completedCount, 3);
 assert.equal(tracks[1].currentActiveLesson.id, 't2_p1_m1_w1');

 // Now stamp Track 2 Week 1 -> Track 2 advances to Week 2 while Track 1 remains on Part 2 Week 1!
 track2Part1.lessons[0].isCompleted = true;
 tracks = resolveMultiTrackBookProgression(combinedClassBooks);
 assert.equal(tracks[1].currentActiveLesson.id, 't2_p1_m1_w2');
 assert.equal(tracks[1].completedCount, 1);
 assert.equal(tracks[0].currentActiveLesson.id, 't1_p2_m1_w1');

 const track2Filtered = resolveCurrentBookProgression(combinedClassBooks, { trackId: 'track_2' });
 assert.equal(track2Filtered.currentActiveLesson.id, 't2_p1_m1_w2');
 assert.equal(normalizeCurriculumTrack({ trackName: 'منهج الألحان القبطية' }).trackName, 'منهج الألحان القبطية');

 // 3. Verify compressPdfInBrowser lossless structural optimization via pdf-lib
 const testPdf = await PDFDocument.create();
 testPdf.setTitle('Heavy Unnecessary Metadata '.repeat(40));
 testPdf.addPage([595, 842]);
 const rawPdfBytes = await testPdf.save({ useObjectStreams: false });
 const compResult = await compressPdfInBrowser(rawPdfBytes, { targetMaxMB: 8.5 });
 assert.ok(compResult.compressedBytes > 0 && compResult.compressedBytes <= rawPdfBytes.byteLength);
 assert.equal(compResult.wasRasterized, false);
});

test('real church structure defines 9 services, 20 classes, unique osraKey codes, and custom/default logo override', async () => {
 await reset();
 const {
  REAL_CHURCH_SERVICES,
  REAL_CHURCH_OSRAS,
  DEFAULT_CHURCH_LOGO_PATH,
  generateUniqueOsraKey,
  collectExistingOsraKeys,
  hasCustomOsraLogo,
  resolveOsraLogoUrl
 } = await import('../src/utils/realChurchStructure.js');

 assert.equal(REAL_CHURCH_SERVICES.length, 9);
 assert.equal(REAL_CHURCH_OSRAS.length, 20);

 const existingKeys = collectExistingOsraKeys(REAL_CHURCH_SERVICES);
 assert.equal(existingKeys.size, 20, 'Every one of the 20 classes must have a unique osraKey');

 for (const osra of REAL_CHURCH_OSRAS) {
  assert.ok(osra.osraKey && osra.osraKey.startsWith('AB-'), `Expected AB-* key for ${osra.name}`);
  assert.equal(osra.defaultLogo, DEFAULT_CHURCH_LOGO_PATH);
  assert.equal(resolveOsraLogoUrl(osra), DEFAULT_CHURCH_LOGO_PATH);
  assert.equal(hasCustomOsraLogo(osra), false);
 }

 const nextNurseryKey = generateUniqueOsraKey('خدمة حضانة', existingKeys);
 assert.equal(existingKeys.has(nextNurseryKey), false);
 assert.equal(nextNurseryKey, 'AB-NUR-04');

 const randomRegenerated = generateUniqueOsraKey('خدمة ابتدائي', existingKeys, true);
 assert.equal(existingKeys.has(randomRegenerated), false);
 assert.ok(randomRegenerated.startsWith('AB-PRI-'));

 // Custom logo override & revert
 const customLogoOsra = {
  ...REAL_CHURCH_OSRAS[0],
  customLogoUrl: 'https://res.cloudinary.com/dqsmwgha/image/upload/v1/osra_custom.png',
  logo: 'https://res.cloudinary.com/dqsmwgha/image/upload/v1/osra_custom.png'
 };
 assert.equal(hasCustomOsraLogo(customLogoOsra), true);
 assert.equal(resolveOsraLogoUrl(customLogoOsra), 'https://res.cloudinary.com/dqsmwgha/image/upload/v1/osra_custom.png');
});

test('خدام مدارس الأحد resolves 5 weekly sessions and Thursday Service vs Thursday Tasbeha never collide', async () => {
 await reset();
 const { REAL_CHURCH_SERVICES } = await import('../src/utils/realChurchStructure.js');
 const { getClassWeeklySessions, getClassScheduleConfig } = await import('../src/utils/serviceWeek.js');
 const { buildCanonicalAttendancePayload } = await import('../src/utils/attendanceSessionHelper.js');
 const { getCanonicalActiveChildren, getValidatedClassAttendance } = await import('../src/utils/churchDataEngine.js');

 const appSettings = { services: REAL_CHURCH_SERVICES };
 const refDate = new Date('2026-11-19T12:00:00'); // Thursday 2026-11-19 .. Wednesday 2026-11-25

 const cfg = getClassScheduleConfig('خدام مدارس الأحد', 'خدام مدارس الأحد', appSettings);
 assert.equal(cfg.scheduleBadge, 'الأحد والخميس • قداس الجمعة • اجتماع الأربعاء • تسبحة الخميس');

 const sessions = getClassWeeklySessions('خدام مدارس الأحد', appSettings, refDate);
 assert.equal(sessions.length, 5);

 const expectedLabels = [
  'خدمة الأحد',
  'خدمة الخميس',
  'قداس الجمعة',
  'اجتماع الخدمة (الأربعاء)',
  'التسبحة (الخميس)'
 ];
 for (const lbl of expectedLabels) {
  assert.ok(sessions.some((s) => s.label === lbl), `Missing session: ${lbl}`);
 }

 const thuService = sessions.find((s) => s.id === 'service_thursday');
 const thuTasbeha = sessions.find((s) => s.id === 'tasbeha_thursday');
 const wedMeeting = sessions.find((s) => s.id === 'service_meeting_wednesday');
 assert.equal(thuService.date, '2026-11-19');
 assert.equal(thuTasbeha.date, '2026-11-19');
 assert.equal(wedMeeting.date, '2026-11-25');

 const servantMember = {
  id: 'srv_member_1',
  cloudId: 'srv_member_1',
  name: 'بيشوي كمال نصيف جرجس',
  syncKey: 'خدام مدارس الأحد',
  isDeleted: false
 };

 const thuServiceAtt = buildCanonicalAttendancePayload({
  child: servantMember,
  date: thuService.date,
  type: thuService.type,
  status: 'present',
  syncKey: 'خدام مدارس الأحد',
  sessionKey: thuService.id,
  sessionLabel: thuService.label
 });

 const thuTasbehaAtt = buildCanonicalAttendancePayload({
  child: servantMember,
  date: thuTasbeha.date,
  type: thuTasbeha.type,
  status: 'present',
  syncKey: 'خدام مدارس الأحد',
  sessionKey: thuTasbeha.id,
  sessionLabel: thuTasbeha.label
 });

 const wedMeetingAtt = buildCanonicalAttendancePayload({
  child: servantMember,
  date: wedMeeting.date,
  type: wedMeeting.type,
  status: 'present',
  syncKey: 'خدام مدارس الأحد',
  sessionKey: wedMeeting.id,
  sessionLabel: wedMeeting.label
 });

 // Strictly non-colliding IDs (${sessionDate}_${childId}_${session.id}) on the exact same Thursday!
 assert.equal(thuServiceAtt.cloudId, '2026-11-19_srv_member_1_service_thursday');
 assert.equal(thuTasbehaAtt.cloudId, '2026-11-19_srv_member_1_tasbeha_thursday');
 assert.notEqual(thuServiceAtt.cloudId, thuTasbehaAtt.cloudId);
 assert.equal(wedMeetingAtt.cloudId, '2026-11-25_srv_member_1_service_meeting_wednesday');

 // Both Thursday records coexist in Dexie and getValidatedClassAttendance without overwriting each other
 await db.children.put(servantMember);
 await db.attendance.bulkAdd([thuServiceAtt, thuTasbehaAtt, wedMeetingAtt]);
 const storedRows = await db.attendance.where('date').equals('2026-11-19').toArray();
 assert.equal(storedRows.length, 2);

 const canonical = getCanonicalActiveChildren([servantMember], ['خدام مدارس الأحد']);
 const validatedThu = getValidatedClassAttendance(storedRows, canonical, {
  targetSyncKey: 'خدام مدارس الأحد',
  exactDate: '2026-11-19'
 });
 assert.equal(validatedThu.presentCount, 1);
 assert.equal(validatedThu.tasbehaCount, 1);
});

test('servant approval WhatsApp helper normalizes Egypt numbers, eliminates undefined, and formats exact 0-emoji church message', async () => {
 await reset();
 const { REAL_CHURCH_SERVICES } = await import('../src/utils/realChurchStructure.js');
 const {
  normalizeEgyptWhatsAppPhone,
  buildServantApprovalWhatsAppMessage,
  buildServantApprovalWhatsAppUrl
 } = await import('../src/utils/whatsappHelper.js');

 assert.equal(normalizeEgyptWhatsAppPhone('012 2334-4556'), '201223344556');
 assert.equal(normalizeEgyptWhatsAppPhone('+20 01011223344'), '201011223344');
 assert.equal(normalizeEgyptWhatsAppPhone('٠٠٢٠١٥٥٦٦٧٧٨٨٩'), '201556677889');

 const approvedServant = {
  name: 'مينا عاطف رزق',
  phone: '01223344556',
  role: 'خادم',
  assignedOsra: 'رابعة ابتدائي',
  syncKey: 'رابعة ابتدائي'
 };

 const msg = buildServantApprovalWhatsAppMessage(
  approvedServant,
  REAL_CHURCH_SERVICES,
  'https://servant-anba-barsoum.vercel.app'
 );

 assert.equal(msg.includes('undefined'), false);
 assert.equal(msg.includes('null'), false);
 assert.equal(msg.includes('localhost'), false);
 assert.ok(msg.includes('سلام ونعمة يا مينا عاطف رزق،'));
 assert.ok(msg.includes('نرحب بك في خدمة كنيسة الأنبا برسوم العريان بطهنشا.'));
 assert.ok(msg.includes('- الخدمة: خدمة ابتدائي'));
 assert.ok(msg.includes('- الأسرة / الفصل: رابعة ابتدائي'));
 assert.ok(msg.includes('- الصلاحية: خادم فصل'));
 assert.ok(msg.includes('- رقم الدخول المسجل: 01223344556'));
 assert.ok(msg.includes('- مفتاح الأسرة الخاص: AB-PRI-04'));
 assert.ok(msg.includes('https://servant-anba-barsoum.vercel.app'));
 assert.equal(/\p{Extended_Pictographic}/u.test(msg), false, 'WhatsApp message must contain 0 emojis');

 const waUrl = buildServantApprovalWhatsAppUrl(
  approvedServant,
  REAL_CHURCH_SERVICES,
  'https://servant-anba-barsoum.vercel.app'
 );
 assert.ok(waUrl.startsWith('https://wa.me/201223344556?text='));
});

test('neutral 3-state attendance: unrecorded session yields 0 present, 0 absent, and all children unmarked', async () => {
 await reset();
 const kids = [
  { id: 'c_1', cloudId: 'c_1', name: 'كيرلس أشرف', syncKey: 'رابعة ابتدائي', updatedAt: 1 },
  { id: 'c_2', cloudId: 'c_2', name: 'مارينا سامح', syncKey: 'رابعة ابتدائي', updatedAt: 1 }
 ];
 const canonical = getCanonicalActiveChildren(kids);
 const res = getValidatedClassAttendance([], canonical, {
  targetSyncKey: 'رابعة ابتدائي',
  exactDate: '2026-11-22'
 });

 assert.equal(res.presentCount, 0);
 assert.equal(res.absentCount, 0);
 assert.equal(res.unmarkedCount, 2);
 assert.equal(res.whoAbsentServiceList.length, 0);
 assert.equal(res.whoUnmarkedServiceList.length, 2);
 assert.equal(res.byClass['رابعة ابتدائي'].absentCount, 0);
 assert.equal(res.byClass['رابعة ابتدائي'].unmarkedCount, 2);
 assert.equal(res.byClass['رابعة ابتدائي'].whoAbsentServiceList.length, 0);
});

test('same-week multi-day sessions count Sunday + Thursday attendances and absences independently without collapsing', async () => {
 await reset();
 const cBothAbsent = { id: 'k_abs2', cloudId: 'k_abs2', name: 'بيشوي عماد', syncKey: 'رابعة ابتدائي', updatedAt: 1 };
 const cMixed = { id: 'k_mix', cloudId: 'k_mix', name: 'مريم هاني', syncKey: 'رابعة ابتدائي', updatedAt: 1 };
 const cAllPresent = { id: 'k_all3', cloudId: 'k_all3', name: 'يوسف ماجد', syncKey: 'رابعة ابتدائي', updatedAt: 1 };
 const canonical = getCanonicalActiveChildren([cBothAbsent, cMixed, cAllPresent]);

 // Service week: Thu 2026-11-19 .. Wed 2026-11-25 (includes Thu 19, Fri 20, Sun 22)
 const weekAttendance = [
  // Child 1: Thursday absent + Sunday absent = 2 service absences
  { date: '2026-11-19', childId: 'k_abs2', syncKey: 'رابعة ابتدائي', type: 'service', sessionKey: 'service_thursday', sessionLabel: 'خدمة الخميس', status: 'absent', updatedAt: 10 },
  { date: '2026-11-22', childId: 'k_abs2', syncKey: 'رابعة ابتدائي', type: 'service', sessionKey: 'service_sunday', sessionLabel: 'خدمة الأحد', status: 'absent', updatedAt: 11 },

  // Child 2: Sunday present + Thursday absent = 1 present + 1 absent in same week
  { date: '2026-11-19', childId: 'k_mix', syncKey: 'رابعة ابتدائي', type: 'service', sessionKey: 'service_thursday', sessionLabel: 'خدمة الخميس', status: 'absent', updatedAt: 12 },
  { date: '2026-11-22', childId: 'k_mix', syncKey: 'رابعة ابتدائي', type: 'service', sessionKey: 'service_sunday', sessionLabel: 'خدمة الأحد', status: 'present', updatedAt: 13 },

  // Child 3: Thursday present + Friday Liturgy present + Sunday present = 2 service + 1 liturgy = 3 total
  { date: '2026-11-19', childId: 'k_all3', syncKey: 'رابعة ابتدائي', type: 'service', sessionKey: 'service_thursday', sessionLabel: 'خدمة الخميس', status: 'present', updatedAt: 14 },
  { date: '2026-11-20', childId: 'k_all3', syncKey: 'رابعة ابتدائي', type: 'liturgy', sessionKey: 'liturgy_friday', sessionLabel: 'قداس الجمعة', status: 'present', updatedAt: 15 },
  { date: '2026-11-22', childId: 'k_all3', syncKey: 'رابعة ابتدائي', type: 'service', sessionKey: 'service_sunday', sessionLabel: 'خدمة الأحد', status: 'present', updatedAt: 16 }
 ];

 const res = getValidatedClassAttendance(weekAttendance, canonical, {
  targetSyncKey: 'رابعة ابتدائي',
  startDate: '2026-11-19',
  endDate: '2026-11-25'
 });

 // Child 1: 2 service absences, 0 present, distinct session labels preserved
 assert.equal(res.byChild['k_abs2'].servicePresentCount, 0);
 assert.equal(res.byChild['k_abs2'].serviceAbsentCount, 2);
 assert.deepEqual(
  res.byChild['k_abs2'].absentEvents.map(e => `${e.sessionLabel}:${e.date}`).sort(),
  ['خدمة الأحد:2026-11-22', 'خدمة الخميس:2026-11-19']
 );

 // Child 2: 1 service present + 1 service absent in the same week
 assert.equal(res.byChild['k_mix'].servicePresentCount, 1);
 assert.equal(res.byChild['k_mix'].serviceAbsentCount, 1);
 assert.ok(res.explicitAbsentServiceIds.has('k_mix'), 'Mixed-week child must keep explicit Thursday absence');
 assert.ok(res.servicePresentIds.has('k_mix'), 'Mixed-week child must keep Sunday presence');

 // Child 3: 2 service + 1 liturgy = 3 total attendances
 assert.equal(res.byChild['k_all3'].servicePresentCount, 2);
 assert.equal(res.byChild['k_all3'].liturgyPresentCount, 1);
 assert.equal(res.byChild['k_all3'].totalPresentCount, 3);
 assert.equal(res.byChild['k_all3'].serviceAbsentCount, 0);

 // Aggregate weekly occurrence totals across the class
 assert.equal(res.servicePresentOccurrences, 3);
 assert.equal(res.serviceAbsentOccurrences, 3);
 assert.equal(res.liturgyPresentOccurrences, 1);
 assert.equal(res.totalPresentOccurrences, 4);

 // Excel export helper also preserves multi-day service attendance & absences independently
 const excel = buildClassExcelExportRows({
  children: [cBothAbsent, cMixed, cAllPresent],
  attendance: weekAttendance,
  refDate: new Date('2026-11-22T12:00:00'),
  allowedSyncKeys: ['رابعة ابتدائي']
 });
 const rowAbs2 = excel.sheet1Rows.find(r => r['كود المخدوم'] === 'k_abs2');
 const rowMix = excel.sheet1Rows.find(r => r['كود المخدوم'] === 'k_mix');
 const rowAll3 = excel.sheet1Rows.find(r => r['كود المخدوم'] === 'k_all3');
 assert.equal(rowAbs2['إجمالي غياب الخدمة'], 2);
 assert.equal(rowAbs2['إجمالي حضور الخدمة'], 0);
 assert.equal(rowMix['إجمالي حضور الخدمة'], 1);
 assert.equal(rowMix['إجمالي غياب الخدمة'], 1);
 assert.equal(rowAll3['إجمالي حضور الخدمة'], 2);
 assert.equal(rowAll3['إجمالي حضور القداس'], 1);
});
