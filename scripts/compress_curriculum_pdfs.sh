#!/usr/bin/env bash
set -euo pipefail

# Ultra-Compression Pipeline for Curriculum PDFs (< 9.4 MB strictly, targeting 2.5 MB - 6.0 MB)
# Conserves Cloudinary 25-credit free tier while preserving crisp, readable Arabic text & illustrations.
#
# Passes:
#   Pass 1: Ghostscript /ebook @ 110 DPI color/gray, 150 DPI mono (fast vector-preserving pass for <= 25 MB PDFs)
#   Pass 2 (if > 6.5 MB or > 25 MB scanned PDF): Poppler pdftoppm + parallel sharp MozJPEG (target ~5.2 MB) + pdf-lib
#   Pass 3 (if > 8.8 MB): Grayscale 720px MozJPEG (quality 32) + pdf-lib
#   Pass 4 (if > 9.4 MB): Split page ranges via pdf-lib into sequential sub-parts

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
OUT_DIR="${OUT_DIR:-${PROJECT_ROOT}/tmp-compressed-pdfs}"

PASS2_THRESHOLD=6815744   # 6.5 MB
PASS3_THRESHOLD=9227468   # 8.8 MB
PASS4_CEILING=9856614     # 9.4 MB
SKIP_IF_UNDER=3670016     # 3.5 MB (already super compact)

INPUT_DIR=""
SINGLE_IN=""
SINGLE_OUT=""
POSITIONAL_FILES=()

while [ "$#" -gt 0 ]; do
    case "$1" in
        --dir|-d)
            INPUT_DIR="$2"
            shift 2
            ;;
        --out|-o)
            OUT_DIR="$2"
            shift 2
            ;;
        --single)
            SINGLE_IN="$2"
            SINGLE_OUT="$3"
            shift 3
            ;;
        *)
            POSITIONAL_FILES+=("$1")
            shift
            ;;
    esac
done

human_mb() {
    awk -v b="$1" 'BEGIN { printf "%.2f MB", b / (1024 * 1024) }'
}

run_pass_1_gs() {
    local src="$1"
    local dst="$2"
    gs -sDEVICE=pdfwrite \
        -dCompatibilityLevel=1.4 \
        -dPDFSETTINGS=/ebook \
        -dNumRenderingThreads=2 \
        -dNOPAUSE -dQUIET -dBATCH \
        -dDetectDuplicateImages=true \
        -dCompressFonts=true \
        -dSubsetFonts=true \
        -dDownsampleColorImages=true \
        -dColorImageDownsampleType=/Average \
        -dColorImageResolution=110 \
        -dDownsampleGrayImages=true \
        -dGrayImageDownsampleType=/Average \
        -dGrayImageResolution=110 \
        -dDownsampleMonoImages=true \
        -dMonoImageDownsampleType=/Subsample \
        -dMonoImageResolution=150 \
        -sOutputFile="${dst}" \
        "${src}"
}

run_poppler_mozjpeg() {
    local src="$1"
    local dst="$2"
    local mode="$3" # "color" | "gray"
    local work_dir
    work_dir="$(mktemp -d /tmp/ab_pdf_comp.XXXXXX)"

    # Determine page count via pdfinfo to choose optimal scale-to resolution
    local pages=120
    if command -v pdfinfo >/dev/null 2>&1; then
        pages="$(pdfinfo "${src}" 2>/dev/null | awk '/^Pages:/ {print $2}' || echo 120)"
        [ -z "${pages}" ] && pages=120
    fi

    local scale_px=880
    if [ "${mode}" = "gray" ]; then
        scale_px=740
    elif [ "${pages}" -gt 220 ]; then
        scale_px=760
    elif [ "${pages}" -gt 160 ]; then
        scale_px=830
    fi

    if [ "${mode}" = "gray" ]; then
        pdftoppm -gray -jpeg -scale-to "${scale_px}" "${src}" "${work_dir}/page"
    else
        pdftoppm -jpeg -scale-to "${scale_px}" "${src}" "${work_dir}/page"
    fi

    NODE_PATH="${PROJECT_ROOT}/node_modules" node --input-type=module - "${work_dir}" "${dst}" "${mode}" <<'EOF'
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';

const [workDir, dstPath, mode] = process.argv.slice(2);
const files = fs.readdirSync(workDir).filter((f) => f.endsWith('.jpg')).sort();
if (files.length === 0) {
    throw new Error('pdftoppm produced 0 pages');
}

const targetTotalBytes = mode === 'gray' ? Math.floor(5.2 * 1024 * 1024) : Math.floor(5.6 * 1024 * 1024);
const pageBudget = Math.max(15 * 1024, Math.floor(targetTotalBytes / files.length));
const baseQuality = mode === 'gray' ? 34 : (files.length > 200 ? 38 : 44);

// Compress pages in parallel batches of 8 via libvips MozJPEG
const encodedPages = new Array(files.length);
const BATCH = 8;
for (let i = 0; i < files.length; i += BATCH) {
    const slice = files.slice(i, i + BATCH);
    await Promise.all(slice.map(async (f, offset) => {
        const idx = i + offset;
        const rawPath = path.join(workDir, f);
        let pipeline = sharp(rawPath);
        if (mode === 'gray') pipeline = pipeline.grayscale();
        let buf = await pipeline.jpeg({ quality: baseQuality, mozjpeg: true }).toBuffer();

        if (buf.byteLength > pageBudget * 1.25) {
            let p2 = sharp(rawPath).resize({ width: 720, height: 980, fit: 'inside', withoutEnlargement: true });
            if (mode === 'gray') p2 = p2.grayscale();
            buf = await p2.jpeg({ quality: Math.max(26, baseQuality - 10), mozjpeg: true }).toBuffer();
        }
        if (buf.byteLength > pageBudget * 1.6) {
            buf = await sharp(rawPath)
                .resize({ width: 620, height: 860, fit: 'inside', withoutEnlargement: true })
                .grayscale()
                .jpeg({ quality: 24, mozjpeg: true })
                .toBuffer();
        }
        const meta = await sharp(buf).metadata();
        encodedPages[idx] = { buf, width: meta.width || 595, height: meta.height || 842 };
    }));
}

const pdf = await PDFDocument.create();
for (const pg of encodedPages) {
    const jpg = await pdf.embedJpg(pg.buf);
    // Normalize page box to standard 595pt width preserving aspect ratio for smooth PdfViewer FitH rendering
    const pdfW = 595.28;
    const pdfH = Math.round((pg.height / pg.width) * pdfW * 100) / 100;
    const page = pdf.addPage([pdfW, pdfH]);
    page.drawImage(jpg, { x: 0, y: 0, width: pdfW, height: pdfH });
}

const outBytes = await pdf.save({ useObjectStreams: true, addDefaultPage: false });
fs.writeFileSync(dstPath, outBytes);
EOF

    rm -rf "${work_dir}"
}

split_pdf_recursive() {
    local pdf_to_split="$1"
    local ceiling_bytes="$2"
    NODE_PATH="${PROJECT_ROOT}/node_modules" node --input-type=module - "${pdf_to_split}" "${ceiling_bytes}" <<'EOF'
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';

const inputPath = process.argv[2];
const ceilingBytes = Number(process.argv[3] || 9856614);
const raw = fs.readFileSync(inputPath);
const rootDoc = await PDFDocument.load(raw, { ignoreEncryption: true });
const totalPages = rootDoc.getPageCount();
const partsNeeded = Math.max(2, Math.ceil(raw.byteLength / (ceilingBytes * 0.85)));
const pagesPerPart = Math.ceil(totalPages / partsNeeded);

const ext = path.extname(inputPath);
const baseNoExt = inputPath.slice(0, -ext.length);
const manifest = [];

for (let idx = 0; idx < partsNeeded; idx += 1) {
    const startZero = idx * pagesPerPart;
    if (startZero >= totalPages) break;
    const endZero = Math.min(totalPages - 1, startZero + pagesPerPart - 1);
    const indices = Array.from({ length: endZero - startZero + 1 }, (_, k) => startZero + k);
    const subDoc = await PDFDocument.create();
    const copied = await subDoc.copyPages(rootDoc, indices);
    copied.forEach((p) => subDoc.addPage(p));
    const subBytes = await subDoc.save({ useObjectStreams: true });
    const partPath = `${baseNoExt}__subpart${idx + 1}${ext}`;
    fs.writeFileSync(partPath, subBytes);
    manifest.push({
        subPartIndex: idx + 1,
        filePath: partPath,
        bytes: subBytes.byteLength,
        startPage: startZero + 1,
        endPage: endZero + 1,
        pageCount: indices.length,
        totalOrigPages: totalPages
    });
}

fs.writeFileSync(`${inputPath}.split.json`, JSON.stringify(manifest, null, 2));
EOF
}

process_single_pdf() {
    local input_file="$1"
    local out_file="$2"

    if [ ! -f "${input_file}" ]; then
        echo "SKIP: File not found -> ${input_file}" >&2
        return 0
    fi

    mkdir -p "$(dirname "${out_file}")"
    rm -f "${out_file}.split.json"

    local base_name
    base_name="$(basename "${input_file}")"
    local orig_bytes
    orig_bytes="$(stat -c%s "${input_file}")"

    if [ "${orig_bytes}" -le "${SKIP_IF_UNDER}" ] && [ "${FORCE_COMPRESS:-0}" != "1" ]; then
        cp -f "${input_file}" "${out_file}"
        echo "PASS0_COPY: ${base_name} | $(human_mb "${orig_bytes}") -> $(human_mb "${orig_bytes}")"
        return 0
    fi

    local best_bytes=999999999
    local used_pass=""

    # Pass 1: For <= 25 MB PDFs, run fast vector-preserving Ghostscript /ebook @ 110 DPI first
    if [ "${orig_bytes}" -le 26214400 ]; then
        local tmp_p1="${out_file}.p1.tmp.pdf"
        if run_pass_1_gs "${input_file}" "${tmp_p1}" 2>/dev/null && [ -f "${tmp_p1}" ]; then
            local p1_bytes
            p1_bytes="$(stat -c%s "${tmp_p1}")"
            if [ "${p1_bytes}" -le "${PASS2_THRESHOLD}" ] && [ "${p1_bytes}" -lt "${orig_bytes}" ]; then
                mv -f "${tmp_p1}" "${out_file}"
                echo "COMPRESSED [Pass1(gs-ebook-110dpi)]: ${base_name} | $(human_mb "${orig_bytes}") -> $(human_mb "${p1_bytes}")"
                return 0
            fi
            rm -f "${tmp_p1}"
        fi
    fi

    # Pass 2: Poppler + sharp MozJPEG (color, adaptive ~5.2 MB target)
    run_poppler_mozjpeg "${input_file}" "${out_file}" "color"
    best_bytes="$(stat -c%s "${out_file}")"
    used_pass="Pass2(mozjpeg-color)"

    # Pass 3: If still > 8.8 MB -> Grayscale 740px MozJPEG
    if [ "${best_bytes}" -gt "${PASS3_THRESHOLD}" ]; then
        local tmp_p3="${out_file}.p3.tmp.pdf"
        run_poppler_mozjpeg "${input_file}" "${tmp_p3}" "gray"
        local p3_bytes
        p3_bytes="$(stat -c%s "${tmp_p3}")"
        if [ "${p3_bytes}" -lt "${best_bytes}" ]; then
            mv -f "${tmp_p3}" "${out_file}"
            best_bytes="${p3_bytes}"
            used_pass="Pass3(mozjpeg-gray)"
        else
            rm -f "${tmp_p3}"
        fi
    fi

    # Pass 4: Safety split if STILL > 9.4 MB
    if [ "${best_bytes}" -gt "${PASS4_CEILING}" ]; then
        split_pdf_recursive "${out_file}" "${PASS4_CEILING}"
        used_pass="${used_pass}+Pass4(AutoSplit)"
    fi

    echo "COMPRESSED [${used_pass}]: ${base_name} | $(human_mb "${orig_bytes}") -> $(human_mb "${best_bytes}")"
}

if [ -n "${SINGLE_IN}" ] && [ -n "${SINGLE_OUT}" ]; then
    process_single_pdf "${SINGLE_IN}" "${SINGLE_OUT}"
    exit 0
fi

mkdir -p "${OUT_DIR}"

if [ -n "${INPUT_DIR}" ]; then
    ABS_IN_DIR="$(cd "${INPUT_DIR}" && pwd)"
    while IFS= read -r -d '' pdf_path; do
        rel_path="${pdf_path#${ABS_IN_DIR}/}"
        process_single_pdf "${pdf_path}" "${OUT_DIR}/${rel_path}"
    done < <(find "${ABS_IN_DIR}" -type f -iname "*.pdf" -print0 | sort -z)
fi

for input_file in "${POSITIONAL_FILES[@]}"; do
    base_name="$(basename "${input_file}")"
    process_single_pdf "${input_file}" "${OUT_DIR}/${base_name}"
done
