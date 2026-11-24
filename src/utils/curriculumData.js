/**
 * Pure Per-Class Curriculum Constants & Seed Builder (Zero DOM/DB side-effects; Node & Browser safe)
 */

export const CURRICULUM_CATEGORIES = [
    'درس كتاب مقدس وعقيدة',
    'ألحان وتسبحة',
    'لغة قبطية وطقس',
    'محفوظات وآيات',
    'ملف PDF / مذكرة',
    'إضافة خادم / نشاط',
    'منهج عام / PDF'
];

export const CURRICULUM_STATUSES = [
    'تم الشرح',
    'مجدول'
];

const TODAY_ISO = () => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
};

/**
 * Generates an offline-ready valid 1-page PDF Data URI so seeded classes and demos
 * can preview & download a genuine PDF document inside the in-app PDF viewer.
 */
export function buildSampleCurriculumPdfDataUri(title = 'Curriculum PDF', subtitle = 'St. Barsoum El-Erian') {
    const safeTitle = String(title || 'Sunday School Curriculum').replace(/[^\x20-\x7E]/g, '').trim() || 'Sunday School Curriculum';
    const safeSub = String(subtitle || 'St. Barsoum El-Erian Church - Tahnasha').replace(/[^\x20-\x7E]/g, '').trim() || 'St. Barsoum El-Erian Church';
    const escapePdfText = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

    const streamBody = [
        'BT',
        '/F1 18 Tf',
        '54 730 Td',
        `(${escapePdfText('St. Barsoum El-Erian Church - Tahnasha')}) Tj`,
        '0 -28 Td',
        '/F1 13 Tf',
        `(${escapePdfText(safeSub)}) Tj`,
        '0 -24 Td',
        '/F1 12 Tf',
        `(${escapePdfText(safeTitle)}) Tj`,
        '0 -32 Td',
        '/F1 11 Tf',
        '(Official Class Curriculum & Study Guide PDF) Tj',
        '0 -18 Td',
        '(Replace or upload your official church PDF file anytime from Admin or Curriculum Manager.) Tj',
        'ET'
    ].join('\n');

    const objects = [
        '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
        `4 0 obj\n<< /Length ${streamBody.length} >>\nstream\n${streamBody}\nendstream\nendobj\n`,
        '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'
    ];

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    for (const obj of objects) {
        offsets.push(pdf.length);
        pdf += obj;
    }
    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    for (let i = 1; i < offsets.length; i += 1) {
        pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    const encodeBase64 = (raw) => {
        if (typeof globalThis.btoa === 'function') return globalThis.btoa(raw);
        if (typeof Buffer !== 'undefined') return Buffer.from(raw, 'binary').toString('base64');
        return '';
    };
    return `data:application/pdf;base64,${encodeBase64(pdf)}`;
}

const makeItem = (syncKey, idx, title, category, description, status = 'تم الشرح', weekLabel = 'الأسبوع الحالي', extra = {}) => ({
    id: `cur_seed_${encodeURIComponent(syncKey).replace(/%/g, '')}_${idx}`,
    syncKey,
    title,
    category,
    itemType: extra.itemType || (category === 'ملف PDF / مذكرة' || category === 'منهج عام / PDF' ? 'pdf' : 'lesson'),
    fileUrl: extra.fileUrl || '',
    pdfData: extra.pdfData || extra.fileUrl || '',
    attachmentUrl: extra.fileUrl || '',
    fileName: extra.fileName || '',
    content: description,
    description,
    status,
    weekLabel,
    lessonDate: TODAY_ISO(),
    updatedAt: '2026-11-14T10:00:00.000Z'
});

const makeSamplePdfItem = (syncKey, osraName, title, description) => {
    const uri = buildSampleCurriculumPdfDataUri(`Curriculum Guide: ${syncKey}`, osraName || syncKey);
    return makeItem(
        syncKey,
        0,
        title,
        'ملف PDF / مذكرة',
        description,
        'تم الشرح',
        'المنهج الرسمي (PDF)',
        {
            itemType: 'pdf',
            fileUrl: uri,
            pdfData: uri,
            fileName: `manhag-${syncKey.replace(/\s+/g, '-')}.pdf`
        }
    );
};

/**
 * Generates strictly syncKey-scoped default curricula (PDF + tailored lessons) for a given class/service.
 */
export function buildDefaultCurriculaForOsra(osra = {}) {
    const syncKey = String(osra.syncKey || osra.name || '').trim();
    const osraLabel = osra.name || syncKey || 'الأسرة';
    const norm = syncKey.replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه');

    if (norm.includes('خدام مدارس الاحد')) {
        return [
            makeSamplePdfItem(syncKey, 'Sunday School Servants', 'دليل منهج خدام مدارس الأحد الشامل (PDF)', 'النسخة الرسمية الكاملة لإعداد الدرس والوسائل التفاعلية والافتقاد لخدام مدارس الأحد.'),
            makeItem(syncKey, 1, 'دليل تحضير درس مدارس الأحد بالوسائل التفاعلية', 'درس كتاب مقدس وعقيدة', 'خطوات بناء الدرس المشوق لحضانة وابتدائي، استخدام وسائل الإيضاح العملية وتطبيق الآية في حياة الطفل.', 'تم الشرح', 'الأسبوع الأول'),
            makeItem(syncKey, 2, 'أساسيات العقيدة الأرثوذكسية بأسلوب مبسط للأطفال', 'درس كتاب مقدس وعقيدة', 'كيفية توصيل عقائد التجسد والفداء وأسرار الكنيسة بروح مفرحة ومفهومة للطفل.', 'تم الشرح', 'الأسبوع الثاني'),
            makeItem(syncKey, 3, 'مراجعة الألحان والطقوس الأساسية لمرحلة الطفولة', 'ألحان وتسبحة', 'ألحان القداس والهوسات المناسبة لتربية الطفل على روح التسبيح داخل الكنيسة.', 'مجدول', 'الأسبوع الثالث')
        ];
    }

    if (norm.includes('اجتماع الخدام العام')) {
        return [
            makeSamplePdfItem(syncKey, 'General Servants Meeting', 'وثيقة المنهج السنوي لاجتماع الخدام العام (PDF)', 'المادة الكاملة لاجتماع الخدام: التلمذة، الافتقاد الأسري، وضوابط الخدمة الكنسية.'),
            makeItem(syncKey, 1, 'فن الافتقاد الفعّال ورعاية الخدام الجدد بروح الكنيسة الأولى', 'درس كتاب مقدس وعقيدة', 'إعداد الخادم روحياً أولاً ثم منهجياً، خطوات زيارة البيت والاطمئنان الأسري ومتابعة الغياب بمحبة حقيقية.', 'تم الشرح', 'الأسبوع الأول'),
            makeItem(syncKey, 2, 'التلمذة والخدمة الجماعية في كنيسة الأنبا برسوم العريان', 'إضافة خادم / نشاط', 'مفاهيم القيادة الخادمة وتنسيق الأسر ومرافقة المخدومين عبر المراحل.', 'مجدول', 'الأسبوع الثاني')
        ];
    }

    if (norm.includes('كي جي') || norm.includes('حضانه')) {
        return [
            makeSamplePdfItem(syncKey, 'Kindergarten Class', `كتاب منهج ${osraLabel} المصور (PDF)`, `منهج الطفولة المبكرة والقصص المصورة والتلوين لأسرة ${osraLabel}.`),
            makeItem(syncKey, 1, 'آية وحكاية: «الرب راعيّ فلا يعوزني شيء» (مزمور ٢٣)', 'محفوظات وآيات', 'حفظ الآية مع ترنيمة «الرب راعي» وقصة الخروف الضال بالصور والتلوين.', 'تم الشرح', 'الأسبوع الأول'),
            makeItem(syncKey, 2, 'قصص المحبة والطاعة: فلك نوح ويوسف الصديق', 'درس كتاب مقدس وعقيدة', 'تعريف طفل الحضانة بمحبة الله ورعايته من خلال أبطال العهد القديم.', 'تم الشرح', 'الأسبوع الثاني')
        ];
    }

    if (norm.includes('ابتدائي') || norm.includes('اولي') || norm.includes('ثانيه') || norm.includes('ثالثه') || norm.includes('رابعه') || norm.includes('خامسه') || norm.includes('سادسه')) {
        return [
            makeSamplePdfItem(syncKey, 'Primary Sunday School', `ملزمة منهج ${osraLabel} — الكتاب والألحان والقبطي (PDF)`, `ملف المنهج المعتمد لأسرة ${osraLabel} شامل الدروس والألحان والمحفوظات.`),
            makeItem(syncKey, 1, `معجزات السيد المسيح وسر المحبة (${osraLabel})`, 'درس كتاب مقدس وعقيدة', 'شرح معجزة شفاء المفلوج وعرس قانا الجليل مع تطبيق عملي للأسرة طوال الأسبوع.', 'تم الشرح', 'الأسبوع الأول'),
            makeItem(syncKey, 2, 'لحن إبنوتي ناي نان (يا الله تراءف علينا) + الهوس الثاني', 'ألحان وتسبحة', 'تحفيظ الربع الأول والثاني بالنغمة القبطية السليمة مع شرح معاني المفردات.', 'تم الشرح', 'الأسبوع الثاني'),
            makeItem(syncKey, 3, 'الحروف القبطية وأدوات المذبح المقدس', 'لغة قبطية وطقس', 'التعرف على الصينية والكأس والمستير والأبروسفارين مع كلمات قبطية يومية.', 'مجدول', 'الأسبوع الثالث')
        ];
    }

    if (norm.includes('اعدادي')) {
        return [
            makeSamplePdfItem(syncKey, 'Preparatory Youth', `مذكرة منهج ${osraLabel} — طقس وعقيدة (PDF)`, `الملف الدراسي الكامل لأسرة ${osraLabel}.`),
            makeItem(syncKey, 1, 'رحلة داخل القداس الإلهي: رفع بخور باكر والأواشي الكبار', 'لغة قبطية وطقس', 'فهم لماذا يرفع الكاهن البخور، معنى الأواشي الثلاث، ودور الشماس داخل الكنيسة.', 'تم الشرح', 'الأسبوع الأول'),
            makeItem(syncKey, 2, 'تفسير تطبيقي لإنجيل معلمنا مرقس الرسول', 'درس كتاب مقدس وعقيدة', 'دراسة شخصيات الإنجيل وتأملات عملية في الشجاعة والالتزام في مرحلة إعدادي.', 'تم الشرح', 'الأسبوع الثاني'),
            makeItem(syncKey, 3, 'حفظ المزامير المختارة + ألحان صلاة الساعة الثالثة والسادسة', 'ألحان وتسبحة', 'تحفيظ مزمور ٥٠ ومزمور ٢٦ وألحان التقدمة والتوزيع.', 'مجدول', 'الأسبوع الثالث')
        ];
    }

    if (norm.includes('ثانوي')) {
        return [
            makeSamplePdfItem(syncKey, 'Secondary Youth', `كتاب منهج ${osraLabel} للشباب (PDF)`, `مذكرة العقيدة وتاريخ الكنيسة والتلمذة لأسرة ${osraLabel}.`),
            makeItem(syncKey, 1, 'سر التوبة والاعتراف والأبوة الروحية للشباب', 'درس كتاب مقدس وعقيدة', 'تأصيل كتابي وآبائي لسر التوبة، وكيفية بناء علاقة متابعة روحية منتظمة مع أب الاعتراف.', 'تم الشرح', 'الأسبوع الأول'),
            makeItem(syncKey, 2, 'تاريخ الكنيسة القبطية ومجمع نيقية وقانون الإيمان', 'لغة قبطية وطقس', 'قراءة حية في بطولة الآباء مثل البابا أثناسيوس الرسولي والدفاع عن الإيمان المستقيم.', 'تم الشرح', 'الأسبوع الثاني'),
            makeItem(syncKey, 3, 'تسبحة نصف الليل وألحان الصوم الكبير والنهضة', 'ألحان وتسبحة', 'تأمل في الهوسات الأربعة والثيؤطوكية ومعاني التسبيح الكيهكي.', 'مجدول', 'الأسبوع الثالث')
        ];
    }

    if (norm.includes('جامعه') || norm.includes('شباب')) {
        return [
            makeSamplePdfItem(syncKey, 'University & Youth', `منهج ودراسات ${osraLabel} (PDF)`, `الملف المرجعي للدراسات العقائدية والآبائية لأسرة ${osraLabel}.`),
            makeItem(syncKey, 1, 'الإيمان والعقل: الرد الكتابي والعلمي على شبهات الشباب المعاصرة', 'درس كتاب مقدس وعقيدة', 'دراسة حوارية حول مصداقية الكتاب المقدس وتناغم الإيمان المسيحي الأرثوذكسي مع الفكر العلمي.', 'تم الشرح', 'الأسبوع الأول'),
            makeItem(syncKey, 2, 'مدخل إلى آباء الكنيسة الأولى والليتورجيا', 'لغة قبطية وطقس', 'قراءات مختارة من كتابات القديسين أثناسيوس وكيرلس وتطبيقها في الحياة الجامعية.', 'تم الشرح', 'الأسبوع الثاني'),
            makeItem(syncKey, 3, 'خطة القراءة اليومية ورسائل القديس بولس الرسول', 'محفوظات وآيات', 'منهج متكامل لدراسة رسالة أفسس وفيلبي بروح التدبير والنضج المهني والروحي.', 'مجدول', 'الأسبوع الثالث')
        ];
    }

    return [
        makeSamplePdfItem(syncKey || 'class', osraLabel, `ملف المنهج الرسمي — ${osraLabel} (PDF)`, `الملف الرسمي المعتمد لأسرة ${osraLabel}.`),
        makeItem(syncKey || 'class', 1, `منهج العقيدة والكتاب المقدس (${osraLabel})`, 'درس كتاب مقدس وعقيدة', 'درس تفاعلي أسبوعي لشرح الإيمان المسيحي الأرثوذكسي وحياة الشركة في الكنيسة.', 'تم الشرح', 'الأسبوع الأول'),
        makeItem(syncKey || 'class', 2, `ألحان ومحفوظات (${osraLabel})`, 'ألحان وتسبحة', 'تحفيظ ألحان القداس والآيات المختارة مع التدريب الجماعي.', 'مجدول', 'الأسبوع الثاني')
    ];
}

/**
 * Ensures every osra inside services[] has a clean, syncKey-scoped curricula[] array
 * while preserving backward-compatible pdfUrl/curriculumUrl & curriculumName fields.
 */
export function hydrateServicesWithCurricula(services = [], options = {}) {
    const seedDefaults = Boolean(options?.seedDefaults);
    return (services || []).map(srv => ({
        ...srv,
        osras: (srv.osras || []).map(osra => {
            const syncKey = String(osra.syncKey || osra.name || '').trim();
            let list = Array.isArray(osra.curricula)
                ? osra.curricula
                    .filter(item => {
                        if (!item) return false;
                        if (!seedDefaults) {
                            const idStr = String(item.id || '');
                            if (idStr.startsWith('cur_seed_') || idStr.startsWith('cur_demo_')) {
                                return false;
                            }
                        }
                        return true;
                    })
                    .map(item => ({
                        ...item,
                        syncKey: item.syncKey || syncKey
                    }))
                : [];

            if (list.length === 0) {
                const seeded = seedDefaults ? buildDefaultCurriculaForOsra(osra) : [];
                const legacyUrl = osra.curriculumUrl || osra.pdfUrl;
                if (legacyUrl && !String(legacyUrl).startsWith('data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZw==')) {
                    seeded.unshift({
                        id: `cur_legacy_${encodeURIComponent(osra.syncKey || osra.id || 'item').replace(/%/g, '')}`,
                        syncKey,
                        title: osra.curriculumName || 'مذكرة ومنهج الأسرة (PDF)',
                        category: 'ملف PDF / مذكرة',
                        itemType: 'pdf',
                        fileUrl: legacyUrl,
                        pdfData: legacyUrl,
                        attachmentUrl: legacyUrl,
                        fileName: osra.curriculumName || 'مذكرة PDF',
                        content: 'تم ترحيل المنهج الأساسي المرفق بهذه الأسرة تلقائياً.',
                        description: 'تم ترحيل المنهج الأساسي المرفق بهذه الأسرة تلقائياً.',
                        status: 'تم الشرح',
                        weekLabel: 'المنهج الرسمي (PDF)',
                        lessonDate: TODAY_ISO(),
                        updatedAt: new Date().toISOString()
                    });
                }
                list = seeded;
            }
            const firstWithFile = list.find(c => c.fileUrl || c.pdfData || c.attachmentUrl) || list[0];
            const cleanLegacyPdfUrl = (url) => {
                const str = String(url || '').trim();
                if (!seedDefaults && str.startsWith('data:application/pdf;base64,')) return '';
                return str;
            };
            const firstUrl = cleanLegacyPdfUrl(osra.pdfUrl) || cleanLegacyPdfUrl(osra.curriculumUrl) || firstWithFile?.fileUrl || firstWithFile?.pdfData || firstWithFile?.attachmentUrl || '';
            return {
                ...osra,
                curricula: list,
                pdfUrl: firstUrl,
                curriculumUrl: cleanLegacyPdfUrl(osra.curriculumUrl) || firstUrl,
                curriculumName: firstUrl ? (osra.curriculumName || firstWithFile?.title || '') : ''
            };
        })
    }));
}
