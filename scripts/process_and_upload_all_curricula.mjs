#!/usr/bin/env node
// scripts/process_and_upload_all_curricula.mjs
// Resumable Production Pipeline for Anba Barsoum El-Erian Church Curricula:
//   1. Recursively scans tmp-pdfs/ (strictly skipping all empty folders — 0 fake data)
//   2. Maps {trackName}/{serviceName}/{className?} -> trackId, trackName, serviceName, syncKey
//   3. Extracts lessons FIRST on original crisp PDFs via extractLessonsFromCopticPdf
//   4. Runs 4-pass Ghostscript + pdf-lib ultra-compression (< 9.4 MB, targeting 2-6 MB) into tmp-compressed-pdfs/
//   5. Uploads to Cloudinary (folder: anba_barsoum_curricula/${trackId}) with resumable upload-checkpoint.json
//   6. Persists lightweight coptic_book_plan docs to Firestore Osras/{syncKey}/curricula/{bookId} on avabarsoom-a869d

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDocs, collection } from 'firebase/firestore';
import { extractLessonsFromCopticPdf, getCopticPartMeta } from '../src/utils/pdfCurriculumIndexer.js';
import { REAL_CHURCH_OSRAS } from '../src/utils/realChurchStructure.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TMP_PDFS_DIR = path.join(PROJECT_ROOT, 'tmp-pdfs');
const COMPRESSED_DIR = path.join(PROJECT_ROOT, 'tmp-compressed-pdfs');
const CHECKPOINT_FILE = path.join(COMPRESSED_DIR, 'upload-checkpoint.json');
const COMPRESS_SCRIPT = path.join(__dirname, 'compress_curriculum_pdfs.sh');

const TRACK_FOLDER_MAP = {
    'منهج الأسقفية': { trackId: 'track_bishopric', trackName: 'منهج الأسقفية' },
    'منهج البابا': { trackId: 'track_pope', trackName: 'منهج البابا' },
    'منهج المدرسة': { trackId: 'track_school', trackName: 'منهج المدرسة' }
};

function loadEnvFile(filePath) {
    const out = {};
    if (!fs.existsSync(filePath)) return out;
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const k = trimmed.slice(0, eq).trim();
        let v = trimmed.slice(eq + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
        }
        out[k] = v;
    }
    return out;
}

function formatMB(bytes) {
    return `${(Number(bytes || 0) / (1024 * 1024)).toFixed(2)} MB`;
}

function discoverPdfFilesRecursive(dir) {
    const results = [];
    if (!fs.existsSync(dir)) return results;
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name, 'ar', { numeric: true })
    );
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...discoverPdfFilesRecursive(fullPath));
        } else if (entry.isFile() && /\.pdf$/i.test(entry.name)) {
            results.push(fullPath);
        }
    }
    return results;
}

function resolvePathMetadata(absPdfPath) {
    const relFromTmp = path.relative(TMP_PDFS_DIR, absPdfPath);
    const segments = relFromTmp.split(path.sep);
    if (segments.length < 3) {
        throw new Error(`Unexpected PDF path structure: ${relFromTmp}`);
    }

    const trackFolder = segments[0].trim();
    const serviceFolder = segments[1].trim();
    const fileName = segments[segments.length - 1].trim();
    const classFolder = segments.length >= 4 ? segments[2].trim() : serviceFolder;

    const trackInfo = TRACK_FOLDER_MAP[trackFolder] || {
        trackId: `track_${trackFolder.replace(/\s+/g, '_')}`,
        trackName: trackFolder
    };

    // Match against REAL_CHURCH_OSRAS to guarantee canonical syncKey
    const matchedOsra = REAL_CHURCH_OSRAS.find(
        (o) =>
            o.syncKey === classFolder ||
            o.name === classFolder ||
            (segments.length === 3 && o.serviceName === serviceFolder)
    );

    if (!matchedOsra) {
        throw new Error(`Could not map folder "${relFromTmp}" to any canonical Church class!`);
    }

    return {
        relPath: relFromTmp.replace(/\\/g, '/'),
        absPdfPath,
        fileName,
        trackId: trackInfo.trackId,
        trackName: trackInfo.trackName,
        serviceName: matchedOsra.serviceName,
        syncKey: matchedOsra.syncKey,
        osraName: matchedOsra.name
    };
}

/**
 * Detects explicit Coptic/Seasonal part hint from filename:
 * - Returns { explicitPart: 1..4 | null, codeOrder: number | null, customLabel?: string }
 */
function parsePartHintFromFileName(fileName = '') {
    const base = fileName.replace(/\.pdf$/i, '').trim();
    const norm = base
        .replace(/[أإآ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .toLowerCase();

    if (norm.includes('سبتمبر') || norm.includes('ديسمبر')) {
        return { explicitPart: 1, codeOrder: null, seasonSuffix: 'سبتمبر - ديسمبر' };
    }
    if (norm.includes('يناير') || norm.includes('ابريل')) {
        return { explicitPart: 2, codeOrder: null, seasonSuffix: 'يناير - أبريل' };
    }
    if (norm.includes('مايو') || norm.includes('اغسطس')) {
        return { explicitPart: 3, codeOrder: null, seasonSuffix: 'مايو - أغسطس' };
    }
    if (norm.includes('الفقره-الافتتاحيه') || norm.includes('الفقره الافتتاحيه') || norm.includes('افتتاحيه')) {
        return { explicitPart: 4, codeOrder: null, seasonSuffix: 'الفقرة الافتتاحية' };
    }

    if (/(?:^|[\s\-_])ج\s*1(?:\D|$)/.test(norm) || norm.includes('الجزء الاول') || norm.includes('الترم الاول')) {
        return { explicitPart: 1, codeOrder: null, seasonSuffix: norm.includes('الترم الاول') ? 'الترم الأول' : 'الجزء الأول' };
    }
    if (/(?:^|[\s\-_])ج\s*2(?:\D|$)/.test(norm) || norm.includes('الجزء الثاني')) {
        return { explicitPart: 2, codeOrder: null, seasonSuffix: 'الجزء الثاني' };
    }
    if (/(?:^|[\s\-_])ج\s*3(?:\D|$)/.test(norm) || norm.includes('الجزء الثالث')) {
        return { explicitPart: 3, codeOrder: null, seasonSuffix: 'الجزء الثالث' };
    }
    if (/(?:^|[\s\-_])ج\s*4(?:\D|$)/.test(norm) || norm.includes('الجزء الرابع')) {
        return { explicitPart: 4, codeOrder: null, seasonSuffix: 'الجزء الرابع' };
    }

    // Prep / Secondary code e.g. "P 1-1", "P 1-3", "S 1-1", "S 1-2"
    const psMatch = base.match(/^([PS])\s*(\d+)\s*-\s*(\d+)$/i);
    if (psMatch) {
        const kind = psMatch[1].toUpperCase();
        const subNum = Number(psMatch[3]);
        if (kind === 'P') {
            return { explicitPart: subNum, codeOrder: subNum, seasonSuffix: '' };
        }
        // For Secondary ("S X-1", "S X-2"), defer exact slot until after explicit "سبتمبر ديسمبر" claims Part 1
        return { explicitPart: null, codeOrder: subNum, seasonSuffix: '' };
    }

    return { explicitPart: null, codeOrder: null, seasonSuffix: '' };
}

/**
 * Assigns non-colliding sequential partNumbers (1..4) within each (syncKey, trackId) group.
 */
function assignPartsForGroup(groupItems = []) {
    const usedParts = new Set();
    const withHints = groupItems.map((item) => ({
        ...item,
        hint: parsePartHintFromFileName(item.fileName)
    }));

    // 1. Assign items with explicit seasonal/part numbers first
    for (const item of withHints) {
        if (item.hint.explicitPart && !usedParts.has(item.hint.explicitPart)) {
            item.partNumber = item.hint.explicitPart;
            usedParts.add(item.partNumber);
        }
    }

    // 2. Sort remaining items by codeOrder then natural filename order and assign next free partNumber (1, 2, 3, 4...)
    const remaining = withHints
        .filter((item) => !item.partNumber)
        .sort((a, b) => {
            const ca = a.hint.codeOrder ?? 999;
            const cb = b.hint.codeOrder ?? 999;
            if (ca !== cb) return ca - cb;
            return a.fileName.localeCompare(b.fileName, 'ar', { numeric: true });
        });

    let nextPart = 1;
    for (const item of remaining) {
        while (usedParts.has(nextPart)) nextPart += 1;
        item.partNumber = nextPart;
        usedParts.add(nextPart);
    }

    return withHints.sort((a, b) => a.partNumber - b.partNumber);
}

function makeBookId(syncKey, trackId, partNumber) {
    const safeSync = Buffer.from(syncKey, 'utf8').toString('hex').slice(0, 24);
    return `book_${trackId}_${safeSync}_p${partNumber}`;
}

async function uploadPdfToCloudinary(pdfBytes, fileName, trackId, cloudName, uploadPreset) {
    const maxBytes = Math.floor(9.8 * 1024 * 1024);
    if (pdfBytes.byteLength > maxBytes) {
        throw new Error(`Compressed PDF ${fileName} (${formatMB(pdfBytes.byteLength)}) exceeds 9.8 MB safety guard!`);
    }

    const endpoint = `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`;
    const folder = `anba_barsoum_curricula/${trackId}`;

    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            const formData = new FormData();
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            formData.append('file', blob, fileName);
            formData.append('upload_preset', uploadPreset);
            formData.append('folder', folder);

            const res = await fetch(endpoint, {
                method: 'POST',
                body: formData
            });

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`HTTP ${res.status}: ${errText}`);
            }

            const data = await res.json();
            if (!data?.secure_url) {
                throw new Error('Cloudinary response missing secure_url');
            }

            return {
                secureUrl: data.secure_url,
                publicId: data.public_id || '',
                bytes: Number(data.bytes || pdfBytes.byteLength)
            };
        } catch (err) {
            lastErr = err;
            console.warn(`  [Retry ${attempt}/3] Cloudinary upload warning for ${fileName}: ${err.message}`);
            await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
    }
    throw lastErr;
}

function sliceLessonsForPageRange(allLessons, chunkStartPage, chunkEndPage, chunkPageCount) {
    const overlapping = allLessons.filter(
        (l) => l.endPage >= chunkStartPage && l.startPage <= chunkEndPage
    );
    const targetList = overlapping.length > 0 ? overlapping : allLessons.slice(0, 8);
    return targetList.slice(0, 120).map((l, idx) => {
        const shiftedStart = Math.max(1, Math.min(chunkPageCount, l.startPage - chunkStartPage + 1));
        const shiftedEnd = Math.max(shiftedStart, Math.min(chunkPageCount, l.endPage - chunkStartPage + 1));
        return {
            ...l,
            id: `${l.id || `lesson_${idx + 1}`}_sub`,
            startPage: shiftedStart,
            endPage: shiftedEnd
        };
    });
}

async function writeBookPlanToFirestore(db, docPayload) {
    const ref = doc(db, 'Osras', docPayload.syncKey, 'curricula', docPayload.id);
    // Strict allowlisted payload for live avabarsoom-a869d rules (with embedded __copticMeta for trackId & trackName)
    const allowlistedDoc = {
        id: docPayload.id,
        title: docPayload.title,
        syncKey: docPayload.syncKey,
        serviceName: docPayload.serviceName,
        category: 'كتاب المنهج السنوي الذكي',
        itemType: 'coptic_book_plan',
        weekLabel: docPayload.partLabel,
        lessonDate: docPayload.createdAt.split('T')[0],
        content: `${docPayload.trackName} — ${docPayload.partLabel} (${docPayload.lessons.length} درس أسبوعي)`,
        description: `${docPayload.trackName} — ${docPayload.partLabel}`,
        notes: docPayload.trackName,
        teacherNotes: JSON.stringify({
            __copticMeta: 1,
            trackId: docPayload.trackId,
            trackName: docPayload.trackName,
            originalFileSize: docPayload.originalFileSize,
            compressedFileSize: docPayload.compressedFileSize
        }),
        fileUrl: docPayload.fileUrl,
        attachmentUrl: docPayload.fileUrl,
        pdfData: '',
        cloudinaryPublicId: docPayload.cloudinaryPublicId || '',
        fileName: docPayload.fileName,
        status: 'مفعّل ومتاح للخدام',
        partNumber: docPayload.partNumber,
        partLabel: docPayload.partLabel,
        totalPages: docPayload.totalPages,
        copticMonths: docPayload.copticMonths.slice(0, 20),
        lessons: docPayload.lessons.slice(0, 120).map((l) => ({
            ...l,
            trackId: docPayload.trackId,
            trackName: docPayload.trackName
        })),
        createdAt: docPayload.createdAt,
        updatedAt: docPayload.updatedAt,
        isDirty: false,
        isDeleted: false
    };

    await setDoc(ref, allowlistedDoc);
}

function readCheckpoint() {
    if (!fs.existsSync(CHECKPOINT_FILE)) return { completedFiles: {} };
    try {
        return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8'));
    } catch {
        return { completedFiles: {} };
    }
}

function saveCheckpoint(cp) {
    fs.mkdirSync(path.dirname(CHECKPOINT_FILE), { recursive: true });
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

async function main() {
    const env = { ...loadEnvFile(path.join(PROJECT_ROOT, '.env')), ...process.env };
    const cloudName = env.VITE_CLOUDINARY_CLOUD_NAME;
    const uploadPreset = env.VITE_CLOUDINARY_UPLOAD_PRESET;
    if (!cloudName || !uploadPreset) {
        throw new Error('Missing Cloudinary credentials in .env!');
    }

    const firebaseConfig = {
        apiKey: env.VITE_FIREBASE_API_KEY,
        authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: env.VITE_FIREBASE_PROJECT_ID,
        storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        appId: env.VITE_FIREBASE_APP_ID
    };
    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    fs.mkdirSync(COMPRESSED_DIR, { recursive: true });
    const checkpoint = readCheckpoint();

    // 1. Discover all real PDFs inside tmp-pdfs/ (strictly ignoring empty folders!)
    const rawPdfPaths = discoverPdfFilesRecursive(TMP_PDFS_DIR);
    console.log(`[CurriculaPipeline] Discovered ${rawPdfPaths.length} real PDF files in tmp-pdfs/ (empty folders skipped strictly).`);

    // Group by (syncKey, trackId) to assign accurate non-colliding partNumbers
    const groupedMap = new Map();
    for (const p of rawPdfPaths) {
        const meta = resolvePathMetadata(p);
        const gk = `${meta.syncKey}::${meta.trackId}`;
        if (!groupedMap.has(gk)) groupedMap.set(gk, []);
        groupedMap.get(gk).push(meta);
    }

    const groupQueues = [];
    let totalPlannedFiles = 0;
    for (const [gk, items] of groupedMap.entries()) {
        const withParts = assignPartsForGroup(items);
        totalPlannedFiles += withParts.length;
        groupQueues.push({ groupKey: gk, items: withParts });
    }

    let finishedFilesCount = 0;
    const GROUP_CONCURRENCY = 4;
    let nextGroupIdx = 0;

    async function processGroup(groupObj) {
        let groupOffset = 0;
        const { groupKey, items } = groupObj;

        for (const item of items) {
            const effectiveBasePart = Math.min(10, item.partNumber + groupOffset);
            const origStat = fs.statSync(item.absPdfPath);
            const originalBytes = origStat.size;

            if (checkpoint.completedFiles[item.relPath]?.firestoreVerified) {
                const cached = checkpoint.completedFiles[item.relPath];
                const extraParts = Math.max(0, (cached.records?.length || 1) - 1);
                if (extraParts > 0) {
                    groupOffset += extraParts;
                }
                finishedFilesCount += 1;
                console.log(`[${finishedFilesCount}/${totalPlannedFiles}] RESUME HIT: ${item.relPath} (${formatMB(cached.originalBytes)} -> ${formatMB(cached.compressedBytes)})`);
                continue;
            }

            // STEP 1: Extract lessons FIRST on original crisp PDF!
            const origBuffer = new Uint8Array(fs.readFileSync(item.absPdfPath));
            const extracted = await extractLessonsFromCopticPdf(origBuffer, item.partNumber, {
                disableWorker: true,
                pdfjsLib
            });

            // STEP 2: 4-Pass Ultra-Compression into tmp-compressed-pdfs/
            const outCompressedPath = path.join(COMPRESSED_DIR, item.relPath);
            const { stdout: cmdStdout } = await execFileAsync(COMPRESS_SCRIPT, ['--single', item.absPdfPath, outCompressedPath], {
                encoding: 'utf8',
                maxBuffer: 16 * 1024 * 1024
            });
            const cmdOut = String(cmdStdout || '').trim();

            const splitManifestPath = `${outCompressedPath}.split.json`;
            const nowIso = new Date().toISOString();
            const uploadedRecords = [];

            if (fs.existsSync(splitManifestPath)) {
                const subParts = JSON.parse(fs.readFileSync(splitManifestPath, 'utf8'));
                let totalSubCompressedBytes = 0;
                for (let sIdx = 0; sIdx < subParts.length; sIdx += 1) {
                    const sp = subParts[sIdx];
                    const effectivePartNum = Math.min(10, effectiveBasePart + sIdx);
                    const subPartBytes = fs.readFileSync(sp.filePath);
                    totalSubCompressedBytes += subPartBytes.byteLength;
                    const subFileName = path.basename(sp.filePath);

                    const uploadRes = await uploadPdfToCloudinary(
                        subPartBytes,
                        subFileName,
                        item.trackId,
                        cloudName,
                        uploadPreset
                    );

                    const subLessons = sliceLessonsForPageRange(
                        extracted.lessons,
                        sp.startPage,
                        sp.endPage,
                        sp.pageCount
                    );
                    const subMonths = Array.from(new Set(subLessons.map((l) => l.copticMonth).filter(Boolean)));
                    const partMeta = getCopticPartMeta(Math.min(4, item.partNumber));
                    const partLabel = `${partMeta.shortLabel} (قسم ${sIdx + 1}/${subParts.length})`;
                    const bookId = makeBookId(item.syncKey, item.trackId, effectivePartNum);
                    const title = `${item.trackName} (${item.osraName}) - ${partLabel}`;

                    await writeBookPlanToFirestore(db, {
                        id: bookId,
                        syncKey: item.syncKey,
                        serviceName: item.serviceName,
                        trackId: item.trackId,
                        trackName: item.trackName,
                        partNumber: effectivePartNum,
                        partLabel,
                        title,
                        fileUrl: uploadRes.secureUrl,
                        cloudinaryPublicId: uploadRes.publicId,
                        fileName: subFileName,
                        totalPages: sp.pageCount,
                        copticMonths: subMonths,
                        lessons: subLessons,
                        originalFileSize: Math.round(originalBytes / subParts.length),
                        compressedFileSize: subPartBytes.byteLength,
                        createdAt: nowIso,
                        updatedAt: nowIso
                    });

                    uploadedRecords.push({
                        bookId,
                        partNumber: effectivePartNum,
                        partLabel,
                        title,
                        cloudinaryUrl: uploadRes.secureUrl,
                        publicId: uploadRes.publicId,
                        compressedBytes: subPartBytes.byteLength,
                        totalPages: sp.pageCount,
                        lessonsCount: subLessons.length
                    });
                }

                if (subParts.length > 1) {
                    groupOffset += (subParts.length - 1);
                }
                checkpoint.completedFiles[item.relPath] = {
                    relPath: item.relPath,
                    syncKey: item.syncKey,
                    serviceName: item.serviceName,
                    trackId: item.trackId,
                    trackName: item.trackName,
                    originalBytes,
                    compressedBytes: totalSubCompressedBytes,
                    wasAutoSplit: true,
                    records: uploadedRecords,
                    firestoreVerified: true,
                    completedAt: nowIso
                };
                saveCheckpoint(checkpoint);
                finishedFilesCount += 1;
                console.log(`[${finishedFilesCount}/${totalPlannedFiles}] SPLIT+UPLOADED: ${item.relPath} | ${formatMB(originalBytes)} -> ${formatMB(totalSubCompressedBytes)} (${subParts.length} sub-parts)`);
            } else {
                const compBytes = fs.readFileSync(outCompressedPath);
                const uploadRes = await uploadPdfToCloudinary(
                    compBytes,
                    item.fileName,
                    item.trackId,
                    cloudName,
                    uploadPreset
                );

                const partMeta = getCopticPartMeta(Math.min(4, item.partNumber));
                const partLabel = item.hint?.seasonSuffix === 'الفقرة الافتتاحية'
                    ? 'الجزء الرابع (الفقرة الافتتاحية)'
                    : partMeta.shortLabel;
                const cleanBaseTitle = item.fileName.replace(/\.pdf$/i, '').trim();
                const title = `${item.trackName} (${item.osraName}) - ${partLabel} — ${cleanBaseTitle}`.slice(0, 190);
                const bookId = makeBookId(item.syncKey, item.trackId, effectiveBasePart);

                await writeBookPlanToFirestore(db, {
                    id: bookId,
                    syncKey: item.syncKey,
                    serviceName: item.serviceName,
                    trackId: item.trackId,
                    trackName: item.trackName,
                    partNumber: effectiveBasePart,
                    partLabel,
                    title,
                    fileUrl: uploadRes.secureUrl,
                    cloudinaryPublicId: uploadRes.publicId,
                    fileName: item.fileName,
                    totalPages: extracted.totalPages,
                    copticMonths: extracted.copticMonths,
                    lessons: extracted.lessons,
                    originalFileSize: originalBytes,
                    compressedFileSize: compBytes.byteLength,
                    createdAt: nowIso,
                    updatedAt: nowIso
                });

                uploadedRecords.push({
                    bookId,
                    partNumber: effectiveBasePart,
                    partLabel,
                    title,
                    cloudinaryUrl: uploadRes.secureUrl,
                    publicId: uploadRes.publicId,
                    compressedBytes: compBytes.byteLength,
                    totalPages: extracted.totalPages,
                    lessonsCount: extracted.lessons.length
                });

                checkpoint.completedFiles[item.relPath] = {
                    relPath: item.relPath,
                    syncKey: item.syncKey,
                    serviceName: item.serviceName,
                    trackId: item.trackId,
                    trackName: item.trackName,
                    originalBytes,
                    compressedBytes: compBytes.byteLength,
                    wasAutoSplit: false,
                    records: uploadedRecords,
                    firestoreVerified: true,
                    completedAt: nowIso
                };
                saveCheckpoint(checkpoint);
                finishedFilesCount += 1;
                console.log(`[${finishedFilesCount}/${totalPlannedFiles}] DONE: ${item.relPath} | ${cmdOut} | ${extracted.lessons.length} lessons`);
            }
        }
    }

    const workers = Array.from({ length: Math.min(GROUP_CONCURRENCY, groupQueues.length) }, async () => {
        while (nextGroupIdx < groupQueues.length) {
            const currentIdx = nextGroupIdx;
            nextGroupIdx += 1;
            await processGroup(groupQueues[currentIdx]);
        }
    });
    await Promise.all(workers);

    // STEP 3: Live Firestore Verification across ALL 20 canonical classes!
    console.log('\n[CurriculaPipeline] Verifying live Firestore documents across all 20 classes on avabarsoom-a869d...');
    let totalCloudDocs = 0;
    let totalCloudLessons = 0;
    const perClassVerification = [];

    for (const osra of REAL_CHURCH_OSRAS) {
        const snap = await getDocs(collection(db, 'Osras', osra.syncKey, 'curricula'));
        const activeDocs = snap.docs.map((d) => d.data()).filter((d) => !d.isDeleted);
        const byTrack = {};
        for (const d of activeDocs) {
            let tName = d.notes || 'غير محدد';
            try {
                const parsedMeta = JSON.parse(d.teacherNotes || '{}');
                if (parsedMeta?.trackName) tName = parsedMeta.trackName;
            } catch {}
            if (!byTrack[tName]) byTrack[tName] = { books: 0, lessons: 0 };
            byTrack[tName].books += 1;
            byTrack[tName].lessons += Array.isArray(d.lessons) ? d.lessons.length : 0;
            totalCloudDocs += 1;
            totalCloudLessons += Array.isArray(d.lessons) ? d.lessons.length : 0;
        }
        perClassVerification.push({
            serviceName: osra.serviceName,
            syncKey: osra.syncKey,
            booksCount: activeDocs.length,
            tracks: byTrack
        });
    }

    const completedEntries = Object.values(checkpoint.completedFiles);
    const sumOrigBytes = completedEntries.reduce((acc, e) => acc + (Number(e.originalBytes) || 0), 0);
    const sumCompBytes = completedEntries.reduce((acc, e) => acc + (Number(e.compressedBytes) || 0), 0);

    const summaryReport = {
        completedAt: new Date().toISOString(),
        sourcePdfCount: totalPlannedFiles,
        firestoreDocsVerified: totalCloudDocs,
        totalLessonsIndexed: totalCloudLessons,
        totalOriginalBytes: sumOrigBytes,
        totalOriginalMB: Number((sumOrigBytes / (1024 * 1024)).toFixed(2)),
        totalCompressedBytes: sumCompBytes,
        totalCompressedMB: Number((sumCompBytes / (1024 * 1024)).toFixed(2)),
        savedPercent: Number((((sumOrigBytes - sumCompBytes) / sumOrigBytes) * 100).toFixed(1)),
        perClassVerification
    };

    const reportArtifactPath = '/home/arsany/.gemini/antigravity/brain/2f9f78d7-2ad7-4cd8-b960-cea50f134740/scratch/curricula_upload_report.json';
    fs.mkdirSync(path.dirname(reportArtifactPath), { recursive: true });
    fs.writeFileSync(reportArtifactPath, JSON.stringify(summaryReport, null, 2));

    console.log('\n=============================================================');
    console.log('[CurriculaPipeline] COMPLETE & VERIFIED ON LIVE FIRESTORE!');
    console.log(`  Source PDFs processed : ${summaryReport.sourcePdfCount}`);
    console.log(`  Firestore docs live   : ${summaryReport.firestoreDocsVerified}`);
    console.log(`  Total lessons indexed : ${summaryReport.totalLessonsIndexed}`);
    console.log(`  Total Original Size   : ${summaryReport.totalOriginalMB} MB`);
    console.log(`  Total Compressed Size : ${summaryReport.totalCompressedMB} MB (-${summaryReport.savedPercent}%)`);
    console.log(`  Report saved to       : ${reportArtifactPath}`);
    console.log('=============================================================');

    process.exit(0);
}

main().catch((err) => {
    console.error('\n[CurriculaPipeline] FATAL ERROR:', err);
    process.exit(1);
});
