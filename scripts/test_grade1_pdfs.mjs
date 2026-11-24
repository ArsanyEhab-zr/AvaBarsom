import fs from 'node:fs';
import path from 'node:path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractLessonsFromCopticPdf } from '../src/utils/pdfCurriculumIndexer.js';

const BASE_DIR = path.resolve(process.cwd(), 'tmp-compressed-pdfs');

const PARTS = [
    { partNumber: 1, file: 'الصف-الأول- ج 1.pdf' },
    { partNumber: 2, file: 'الصف-الأول- ج2.pdf' },
    { partNumber: 3, file: 'الصف-الأول- ج 3.pdf' }
];

async function main() {
    for (const part of PARTS) {
        const fullPath = path.join(BASE_DIR, part.file);
        if (!fs.existsSync(fullPath)) {
            console.error(`MISSING: ${fullPath}`);
            process.exitCode = 1;
            continue;
        }
        const buf = fs.readFileSync(fullPath);
        const bytesMb = (buf.byteLength / (1024 * 1024)).toFixed(2);
        const res = await extractLessonsFromCopticPdf(new Uint8Array(buf), part.partNumber, {
            pdfjsLib,
            disableWorker: true
        });

        console.log(`\n======================================================================`);
        console.log(`PART ${part.partNumber}: ${part.file} (${bytesMb} MB) | Total Pages: ${res.totalPages} | Detected: ${res.detectedCount}/${res.lessons.length} | Fallback: ${res.usedFallback}`);
        console.log(`======================================================================`);
        res.lessons.forEach((l, i) => {
            console.log(
                `${String(i + 1).padStart(2, '0')}. [${l.copticMonth} - ${l.weekLabel}] ` +
                `ص ${String(l.startPage).padStart(3, ' ')} -> ${String(l.endPage).padStart(3, ' ')} | ${l.title}`
            );
        });
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
