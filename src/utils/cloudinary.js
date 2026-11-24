import { TENANT_CONFIG } from './tenantConfig';
import { compressPdfInBrowser } from './pdfCurriculumIndexer';

const readViteEnv = (getter, fallback = '') => {
    try {
        const val = getter();
        return val !== undefined && val !== null && String(val).trim() !== '' ? String(val).trim() : fallback;
    } catch {
        return fallback;
    }
};

const decodeGuard = (b64) => {
    try {
        if (typeof atob === 'function') return atob(b64).toLowerCase();
        if (typeof globalThis.Buffer !== 'undefined') return globalThis.Buffer.from(b64, 'base64').toString('utf8').toLowerCase();
    } catch {
        return '';
    }
    return '';
};

const FORBIDDEN_CLOUDINARY_B64 = [
    'anZjaWx5dzI=',
    'ZHRwZ3Rjazd1',
    'a2hlZG1ldHk=',
    'a2hlZG1pdHk='
];

export const getCloudinaryConfig = () => {
    const cloudName = readViteEnv(() => import.meta.env.VITE_CLOUDINARY_CLOUD_NAME, TENANT_CONFIG.cloudinaryCloudName || '');
    const uploadPreset = readViteEnv(() => import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET, TENANT_CONFIG.cloudinaryUploadPreset || '');
    const isPlaceholder = /^(your_|placeholder|change_me|example)/i.test(cloudName) || /^(your_|placeholder|change_me|example)/i.test(uploadPreset);
    const forbiddenTokens = FORBIDDEN_CLOUDINARY_B64.map(decodeGuard).filter(Boolean);
    const combined = `${cloudName} ${uploadPreset}`.toLowerCase();
    const isForbiddenLegacy = forbiddenTokens.some((tok) => combined.includes(tok));

    return {
        cloudName,
        uploadPreset,
        isConfigured: Boolean(cloudName && uploadPreset && !isPlaceholder && !isForbiddenLegacy),
        isForbiddenLegacy,
    };
};

const sanitizeCloudinarySegment = (value, fallback = 'general') => {
    const clean = String(value || '').trim().replace(/[^a-zA-Z0-9\u0600-\u06FF_-]+/g, '_').replace(/^_+|_+$/g, '');
    return clean || fallback;
};

const getTenantFolderPrefix = () => sanitizeCloudinarySegment(TENANT_CONFIG.tenantId, 'st-barsoum-tahnasha');

const resolveCloudinaryErrorMessage = (data, fallbackStatus) => {
    const apiMsg = data?.error?.message;
    if (apiMsg) return `فشل الرفع إلى Cloudinary: ${apiMsg}`;
    return `فشل الرفع إلى السحابة (كود ${fallbackStatus || 'غير معروف'})`;
};

const readSourceAsDataUrl = (fileOrDataUri) => {
    if (typeof fileOrDataUri === 'string') {
        return Promise.resolve(fileOrDataUri);
    }
    return new Promise((resolve, reject) => {
        if (!fileOrDataUri) return reject(new Error('لم يتم تحديد ملف'));
        if (typeof FileReader === 'undefined') return reject(new Error('FileReader غير متاح في هذه البيئة'));
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('فشل قراءة الملف'));
        reader.onload = (event) => resolve(event.target.result);
        reader.readAsDataURL(fileOrDataUri);
    });
};

const dataUrlToBlob = (dataUrl) => {
    const raw = String(dataUrl || '');
    const parts = raw.split(',');
    const mimeMatch = parts[0]?.match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
    const bstr = atob(parts[1] || '');
    const u8arr = new Uint8Array(bstr.length);
    for (let i = 0; i < bstr.length; i += 1) {
        u8arr[i] = bstr.charCodeAt(i);
    }
    return new Blob([u8arr], { type: mime });
};

export const compressImageToBase64 = (fileOrDataUri, maxWidth = 800, maxHeight = 800, quality = 0.82) => {
    return new Promise((resolve, reject) => {
        if (!fileOrDataUri) return reject(new Error("لم يتم تحديد ملف صورة"));
        if (typeof Image === 'undefined' || typeof document === 'undefined') {
            if (typeof fileOrDataUri === 'string') return resolve(fileOrDataUri);
            return reject(new Error("معالجة الصور غير متاحة في هذه البيئة"));
        }
        readSourceAsDataUrl(fileOrDataUri).then((dataUrl) => {
            const img = new Image();
            img.onerror = () => reject(new Error("فشل معالجة الصورة"));
            img.onload = () => {
                let { width, height } = img;
                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }
                } else if (height > maxHeight) {
                    width = Math.round((width * maxHeight) / height);
                    height = maxHeight;
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
                resolve(compressedDataUrl);
            };
            img.src = dataUrl;
        }).catch(reject);
    });
};

const assertCloudinaryReady = () => {
    const config = getCloudinaryConfig();
    if (config.isForbiddenLegacy) {
        throw new Error("تم حظر الرفع لحساب Cloudinary الخاص بالكنيسة السابقة. يرجى ضبط إعدادات الكنيسة الجديدة في .env.");
    }
    if (!config.isConfigured) {
        throw new Error("إعدادات Cloudinary غير مفعلة في ملف .env حتى الآن. يمكنك استخدام حفظ الصور محلياً أو رابط ملف خارجي مباشر.");
    }
    return config;
};

export const uploadImageToCloudinary = async (fileOrDataUri, optionsOrResourceType = {}) => {
    const opts = typeof optionsOrResourceType === 'string'
        ? { resourceType: optionsOrResourceType }
        : (optionsOrResourceType || {});

    const { cloudName, uploadPreset } = assertCloudinaryReady();
    const resourceType = opts.resourceType || 'image';
    const maxWidth = opts.maxWidth || 800;
    const maxHeight = opts.maxHeight || maxWidth;
    const quality = opts.quality || 0.82;
    const classSegment = sanitizeCloudinarySegment(opts.syncKey, 'general');
    const folder = opts.folder || `${getTenantFolderPrefix()}/${classSegment}/photos`;

    let uploadPayload = fileOrDataUri;
    const isImageFile = typeof fileOrDataUri !== 'string' && fileOrDataUri?.type?.startsWith('image/');
    const isImageDataUrl = typeof fileOrDataUri === 'string' && fileOrDataUri.startsWith('data:image/');

    if ((isImageFile || isImageDataUrl) && typeof Image !== 'undefined' && typeof document !== 'undefined') {
        try {
            uploadPayload = await compressImageToBase64(fileOrDataUri, maxWidth, maxHeight, quality);
        } catch (compressionErr) {
            console.warn('[Cloudinary] Image compression skipped, uploading original:', compressionErr?.message);
        }
    }

    const formData = new FormData();
    formData.append("file", uploadPayload);
    formData.append("upload_preset", uploadPreset);
    formData.append("folder", folder);

    try {
        const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`, {
            method: "POST",
            body: formData
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.secure_url) {
            throw new Error(resolveCloudinaryErrorMessage(data, response.status));
        }
        return data.secure_url;
    } catch (error) {
        console.error("Cloudinary upload error:", error);
        throw error;
    }
};

export const uploadVideoToCloudinary = async (file, options = {}) => {
    const { cloudName, uploadPreset } = assertCloudinaryReady();
    if (!file) throw new Error('يرجى اختيار ملف فيديو أولاً.');
    const classSegment = sanitizeCloudinarySegment(options?.syncKey, 'general');
    const folder = options?.folder || `${getTenantFolderPrefix()}/${classSegment}/videos`;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', uploadPreset);
    formData.append('folder', folder);

    try {
        const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/video/upload`, {
            method: 'POST',
            body: formData
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.secure_url) {
            throw new Error(resolveCloudinaryErrorMessage(data, response.status));
        }
        return {
            secureUrl: data.secure_url,
            publicId: data.public_id || '',
            format: data.format || '',
            bytes: Number(data.bytes || 0),
            duration: Number(data.duration || 0)
        };
    } catch (error) {
        console.error('Cloudinary video upload error:', error);
        throw error;
    }
};

export const CLOUDINARY_MAX_PDF_MB = 9.8;
export const CLOUDINARY_MAX_PDF_BYTES = Math.floor(CLOUDINARY_MAX_PDF_MB * 1024 * 1024);

export const validateCloudinaryPdfSize = (fileOrBlob) => {
    const bytes = Number(fileOrBlob?.size || 0);
    const sizeMb = bytes > 0 ? Number((bytes / (1024 * 1024)).toFixed(2)) : 0;
    if (bytes > CLOUDINARY_MAX_PDF_BYTES) {
        return {
            ok: false,
            bytes,
            sizeMb,
            message: `حجم ملف الـ PDF المختار (${sizeMb} ميجابايت) يتجاوز الحد الأقصى المسموح به على باقة Cloudinary المجانية (10 ميجابايت). يرجى ضغط الملف أولاً ليكون أقل من 9.8 ميجابايت ثم إعادة المحاولة.`
        };
    }
    return { ok: true, bytes, sizeMb, message: '' };
};

export const uploadPdfOrFileToCloudinary = async (fileOrDataUri, options = {}) => {
    const { cloudName, uploadPreset } = assertCloudinaryReady();
    const classSegment = sanitizeCloudinarySegment(options?.syncKey, 'general');
    const folder = options?.folder || `${getTenantFolderPrefix()}/${classSegment}/curricula`;
    const onProgress = typeof options?.onProgress === 'function' ? options.onProgress : null;

    let fileToSend = fileOrDataUri;
    if (typeof fileOrDataUri === 'string' && fileOrDataUri.startsWith('data:')) {
        const blob = dataUrlToBlob(fileOrDataUri);
        const ext = blob.type.includes('pdf') ? 'pdf' : (blob.type.split('/')[1] || 'bin');
        const cleanTitle = sanitizeCloudinarySegment(options?.title, 'curriculum');
        fileToSend = typeof File !== 'undefined'
            ? new File([blob], `${cleanTitle}.${ext}`, { type: blob.type })
            : blob;
    }

    const isPdfFile = Boolean(
        fileToSend &&
        (String(fileToSend.type || '').toLowerCase().includes('pdf') ||
            String(fileToSend.name || '').toLowerCase().endsWith('.pdf'))
    );
    if (isPdfFile && Number(fileToSend.size || 0) > Math.floor(9.2 * 1024 * 1024) && typeof document !== 'undefined') {
        try {
            const compressedRes = await compressPdfInBrowser(fileToSend, {
                targetMaxMB: 8.5,
                hardCeilingMB: 9.2
            });
            if (compressedRes?.file) {
                fileToSend = compressedRes.file;
            }
        } catch (compErr) {
            console.warn('[Cloudinary] Auto PDF compression warning:', compErr?.message || compErr);
        }
    }

    const sizeCheck = validateCloudinaryPdfSize(fileToSend);
    if (!sizeCheck.ok) {
        throw new Error(sizeCheck.message);
    }

    const formData = new FormData();
    formData.append('file', fileToSend);
    formData.append('upload_preset', uploadPreset);
    formData.append('folder', folder);

    const endpoint = `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`;

    try {
        if (onProgress && typeof XMLHttpRequest !== 'undefined') {
            const data = await new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', endpoint, true);
                xhr.upload.onprogress = (ev) => {
                    if (ev.lengthComputable && ev.total > 0) {
                        const pct = Math.min(99, Math.max(1, Math.round((ev.loaded / ev.total) * 100)));
                        onProgress(pct);
                    }
                };
                xhr.onload = () => {
                    let parsed = {};
                    try {
                        parsed = JSON.parse(xhr.responseText || '{}');
                    } catch {
                        parsed = {};
                    }
                    if (xhr.status >= 200 && xhr.status < 300 && parsed?.secure_url) {
                        onProgress(100);
                        resolve(parsed);
                    } else {
                        reject(new Error(resolveCloudinaryErrorMessage(parsed, xhr.status)));
                    }
                };
                xhr.onerror = () => reject(new Error('تعذر الاتصال بخادم Cloudinary أثناء رفع الملف. تأكد من الإنترنت وحاول مرة أخرى.'));
                xhr.send(formData);
            });
            return {
                secureUrl: data.secure_url,
                publicId: data.public_id || '',
                format: data.format || '',
                bytes: Number(data.bytes || 0)
            };
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            body: formData
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.secure_url) {
            throw new Error(resolveCloudinaryErrorMessage(data, response.status));
        }
        if (onProgress) onProgress(100);
        return {
            secureUrl: data.secure_url,
            publicId: data.public_id || '',
            format: data.format || '',
            bytes: Number(data.bytes || 0)
        };
    } catch (error) {
        console.error('Cloudinary PDF/file upload error:', error);
        throw error;
    }
};

/**
 * Resilient Image Uploader:
 * 1. Checks online status and Cloudinary configuration; if offline or unconfigured, safely falls back to compressed Base64.
 * 2. If online and configured, compresses & uploads to Cloudinary folder.
 * 3. If CDN upload fails, safely falls back to compressed Base64.
 */
export const uploadImageWithFallback = async (file, optionsOrResourceType = 'image') => {
    const { isConfigured } = getCloudinaryConfig();
    const opts = typeof optionsOrResourceType === 'string'
        ? { resourceType: optionsOrResourceType === 'auto' ? 'image' : optionsOrResourceType }
        : (optionsOrResourceType || {});

    if (typeof navigator !== 'undefined' && (!navigator.onLine || !isConfigured)) {
        if (!isConfigured) {
            console.info("Cloudinary not configured yet — storing compressed Base64 image locally.");
        }
        return await compressImageToBase64(file, opts.maxWidth || 800, opts.maxHeight || 800, opts.quality || 0.82);
    }
    try {
        const secureUrl = await uploadImageToCloudinary(file, opts);
        if (secureUrl) return secureUrl;
    } catch (cdnError) {
        console.warn("CDN upload failed, seamlessly falling back to compressed Base64:", cdnError);
    }
    return await compressImageToBase64(file, opts.maxWidth || 800, opts.maxHeight || 800, opts.quality || 0.82);
};

/**
 * Converts a local Base64 data URI (image or PDF) into a hosted Cloudinary HTTPS URL
 * before syncing to Firestore so multi-MB Base64 blobs never bloat Firestore documents.
 */
export const upgradeDataUriToCloudinary = async (sourceUrl, options = {}) => {
    const raw = String(sourceUrl || '').trim();
    if (!raw || !raw.startsWith('data:')) {
        return { url: raw, publicId: '', upgraded: false, pendingUpload: false };
    }
    const { isConfigured, isForbiddenLegacy } = getCloudinaryConfig();
    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (isForbiddenLegacy || !isConfigured || isOffline || typeof fetch !== 'function') {
        return { url: raw, publicId: '', upgraded: false, pendingUpload: true };
    }
    try {
        const isPdf = options.kind === 'pdf' || raw.toLowerCase().startsWith('data:application/pdf');
        if (isPdf) {
            const uploaded = await uploadPdfOrFileToCloudinary(raw, {
                syncKey: options.syncKey,
                title: options.title || 'curriculum'
            });
            return {
                url: uploaded.secureUrl,
                publicId: uploaded.publicId || '',
                format: uploaded.format || '',
                bytes: uploaded.bytes || 0,
                upgraded: Boolean(uploaded.secureUrl),
                pendingUpload: false
            };
        }
        const secureUrl = await uploadImageToCloudinary(raw, {
            syncKey: options.syncKey,
            maxWidth: options.maxWidth || 800,
            quality: options.quality || 0.82
        });
        return {
            url: secureUrl || raw,
            publicId: '',
            upgraded: Boolean(secureUrl && secureUrl !== raw),
            pendingUpload: !secureUrl
        };
    } catch (err) {
        console.warn('[Cloudinary] Data URI auto-upgrade deferred (keeping local copy):', err?.message || err);
        return { url: raw, publicId: '', upgraded: false, pendingUpload: true };
    }
};

