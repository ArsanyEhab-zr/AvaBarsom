import process from 'node:process';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const VALID_EDITIONS = ['admin', 'servant', 'parent', 'all'];

function resolveBuildEditionMeta(rawEdition, { churchName, shortName, description }) {
  const clean = String(rawEdition || '').trim().toLowerCase();
  const edition = VALID_EDITIONS.includes(clean) ? clean : 'all';

  const editionMap = {
    admin: {
      id: 'admin',
      name: `${churchName} • الأدمن`,
      shortName: 'أدمن الأنبا برسوم',
      description: `تطبيق الأدمن والأمناء — ${description}`,
      startUrl: '/',
      themeColor: '#1B2A59',
      iconBase: '/editions/admin',
      includeAssets: [
        'editions/admin/logo.png',
        'editions/admin/pwa-192x192.png',
        'editions/admin/pwa-512x512.png',
        'editions/admin/og-image.png',
        'editions/admin/favicon.ico',
        'editions/admin/apple-touch-icon.png'
      ]
    },
    servant: {
      id: 'servant',
      name: `${churchName} • الخدام`,
      shortName: 'خدام الأنبا برسوم',
      description: `تطبيق الخادم والخادمة — ${description}`,
      startUrl: '/',
      themeColor: '#059669',
      iconBase: '/editions/servant',
      includeAssets: [
        'editions/servant/logo.png',
        'editions/servant/pwa-192x192.png',
        'editions/servant/pwa-512x512.png',
        'editions/servant/og-image.png',
        'editions/servant/favicon.ico',
        'editions/servant/apple-touch-icon.png'
      ]
    },
    parent: {
      id: 'parent',
      name: `${churchName} • ولي الأمر`,
      shortName: 'ولي أمر - الأنبا برسوم',
      description: `بوابة ولي الأمر والمخدوم — ${description}`,
      startUrl: '/#/parent-login',
      themeColor: '#0284C7',
      iconBase: '/editions/parent',
      includeAssets: [
        'editions/parent/logo.png',
        'editions/parent/pwa-192x192.png',
        'editions/parent/pwa-512x512.png',
        'editions/parent/og-image.png',
        'editions/parent/favicon.ico',
        'editions/parent/apple-touch-icon.png'
      ]
    },
    all: {
      id: 'all',
      name: churchName,
      shortName,
      description,
      startUrl: '/',
      themeColor: '#1B2A59',
      iconBase: '',
      includeAssets: [
        'logo.png',
        'pwa-192x192.png',
        'pwa-512x512.png',
        'og-image.png',
        'favicon.ico',
        'apple-touch-icon.png'
      ]
    }
  };

  return editionMap[edition];
}

function editionHtmlTransformPlugin(meta) {
  return {
    name: 'edition-html-branding',
    transformIndexHtml(html) {
      if (!meta || meta.id === 'all') return html;
      const base = meta.iconBase;
      return html
        .replace(/<title>[\s\S]*?<\/title>/i, `<title>${meta.name}</title>`)
        .replace(/href="\/logo\.png(\?v=\d+)?"/g, `href="${base}/logo.png?v=3"`)
        .replace(/href="\/pwa-192x192\.png(\?v=\d+)?"/g, `href="${base}/pwa-192x192.png?v=3"`)
        .replace(/href="\/pwa-512x512\.png(\?v=\d+)?"/g, `href="${base}/pwa-512x512.png?v=3"`)
        .replace(/href="\/favicon\.ico(\?v=\d+)?"/g, `href="${base}/favicon.ico?v=3"`)
        .replace(/href="\/apple-touch-icon\.png(\?v=\d+)?"/g, `href="${base}/apple-touch-icon.png?v=3"`)
        .replace(/content="\/og-image\.png"/g, `content="${base}/og-image.png"`)
        .replace(/content="#1B2A59"/g, `content="${meta.themeColor}"`);
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const churchName = env.VITE_CHURCH_NAME?.trim() || 'كنيسة الأنبا برسوم العريان بطهنشا';
  const shortName = env.VITE_CHURCH_SHORT_NAME?.trim() || 'كنيسة الأنبا برسوم - طهنشا';
  const description = env.VITE_SERVICE_TITLE?.trim() || 'منظومة إدارة الخدمات ومدارس الأحد والمناهج';
  const rawEdition = process.env.VITE_APP_EDITION || env.VITE_APP_EDITION || 'all';
  const editionMeta = resolveBuildEditionMeta(rawEdition, { churchName, shortName, description });

  return {
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-router-dom',
        'dexie',
        'dexie-react-hooks',
        'lucide-react',
        'date-fns',
        'date-fns/locale',
        'qrcode.react',
        'html5-qrcode',
        'xlsx'
      ]
    },
    build: {
      chunkSizeWarningLimit: 1200,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: 'vendor-firebase',
                test: /[\\/]node_modules[\\/](@firebase|firebase)[\\/]/,
                priority: 20
              },
              {
                name: 'vendor-xlsx',
                test: /[\\/]node_modules[\\/]xlsx[\\/]/,
                priority: 20
              },
              {
                name: 'vendor-qr',
                test: /[\\/]node_modules[\\/](html5-qrcode|qrcode\.react)[\\/]/,
                priority: 20
              },
              {
                name: 'vendor-icons-ui',
                test: /[\\/]node_modules[\\/](lucide-react|framer-motion)[\\/]/,
                priority: 20
              },
              {
                name: 'vendor-data',
                test: /[\\/]node_modules[\\/](dexie|dexie-react-hooks|date-fns)[\\/]/,
                priority: 20
              },
              {
                name: 'vendor-react',
                test: /[\\/]node_modules[\\/](react|react-dom|react-router-dom|react-router)[\\/]/,
                priority: 20
              },
              {
                name: 'vendor-pdf',
                test: /[\\/]node_modules[\\/](react-pdf|pdfjs-dist)[\\/]/,
                priority: 20
              },
              {
                name: 'vendor-pdf-lib',
                test: /[\\/]node_modules[\\/](pdf-lib|@pdf-lib|pako|upng-js)[\\/]/,
                priority: 20
              },
              {
                name: 'feature-coptic-pdf',
                test: /[\\/]src[\\/](utils[\\/]pdfCurriculumIndexer|components[\\/]CopticBookProgressionSection)/,
                priority: 15
              }
            ]
          }
        }
      }
    },
    plugins: [
      tailwindcss(),
      react(),
      editionHtmlTransformPlugin(editionMeta),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        includeAssets: editionMeta.includeAssets,
        manifest: {
          name: editionMeta.name,
          short_name: editionMeta.shortName,
          start_url: editionMeta.startUrl,
          description: editionMeta.description,
          theme_color: editionMeta.themeColor,
          background_color: '#FAF7F2',
          display: 'standalone',
          dir: 'rtl',
          lang: 'ar',
          icons: [
            {
              src: `${editionMeta.iconBase}/pwa-192x192.png?v=3`,
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: `${editionMeta.iconBase}/pwa-512x512.png?v=3`,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any'
            }
          ]
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 10 * 1024 * 1024
        }
      })
    ]
  };
});
