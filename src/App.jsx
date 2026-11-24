import React, { useState, useEffect, Component } from 'react';
import useNetworkStatus from './hooks/useNetworkStatus';
import useChildrenRealtimeSync from './hooks/useChildrenRealtimeSync';
import { Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { getImpersonatedOsra, exitOsraImpersonation, resolveUserAccessScope } from './utils/notificationScopeEngine';
import { getAppEdition, applyEditionBrandingToDOM,
    readScopedStorage
} from './utils/tenantConfig';

import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import ChildProfile from './pages/ChildProfile';
import ChildInfo from './pages/ChildInfo';
import Attendance from './pages/Attendance';
import Visitation from './pages/Visitation';
import ExamsManager from './pages/ExamsManager';
import InfoDirectory from './pages/InfoDirectory';
import ChurchHierarchy from './pages/ChurchHierarchy';
import Login from './pages/Login';
import ParentLogin from './pages/ParentLogin';
import ParentDashboard from './pages/ParentDashboard';
import SignUp from './pages/SignUp';
import SystemAdmin from './pages/SystemAdmin';
import PdfViewer from './pages/PdfViewer';
import QrScannerPoC from './pages/QrScannerPoC';
import QrAttendance from './pages/QrAttendance';
import QrCardGenerator from './pages/QrCardGenerator';
import MasterDashboard from './pages/MasterDashboard';
import TrackingDashboards from './pages/TrackingDashboards';
import ServantsFollowUp from './pages/ServantsFollowUp';
import ServantsMonthlyReport from './pages/ServantsMonthlyReport';
import ServantSelfCheckIn from './pages/ServantSelfCheckIn';
import MasterActivityLogs from './pages/MasterActivityLogs';
import ServantProfile from './components/ServantProfile';
import PointsLeaderboard from './pages/PointsLeaderboard';
import CurriculumManager from './pages/CurriculumManager';
import CalendarPage from './pages/CalendarPage';
import AddEventPage from './pages/AddEventPage';
import EventDetailsPage from './pages/EventDetailsPage';

import BottomNav from './components/BottomNav';
import Footer from './components/Footer';
import ScrollToTop from './components/ScrollToTop';

// نظام التحديث والإشعارات
import BackButtonHandler from './components/BackButtonHandler';
import NotificationManager from './components/NotificationManager';
import GlobalSyncBadge from './components/GlobalSyncBadge';
import { doc, getDoc, getDocFromServer, getDocFromCache } from 'firebase/firestore';
import { firestore } from './db/firebase';
import { purgeLocalDemoDataOnce } from './utils/demoSeeder';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import { Download, AlertTriangle, Rocket, RotateCcw, ArrowRight } from 'lucide-react';

// رقم النسخة الحالية
const CURRENT_APP_VERSION = "1.4";

// Boundary حماية من أخطاء العرض المفاجئة
class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, errorMessage: error?.message || 'حدث خطأ غير متوقع في عرض هذه الصفحة' };
  }

  componentDidCatch(error) {
    console.error('[AppErrorBoundary] UI render error caught:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen coptic-cream-surface flex items-center justify-center p-6 text-center" dir="rtl">
          <div className="coptic-card rounded-[2rem] max-w-md w-full p-7 shadow-xl border border-amber-300/60">
            <div className="w-16 h-16 rounded-2xl bg-amber-100/80 text-amber-800 border border-amber-300 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle size={32} />
            </div>
            <h2 className="text-xl font-black text-[#1B2A59] mb-2">تعذر عرض الصفحة مؤقتاً</h2>
            <p className="text-sm font-bold text-[#6E5233] leading-relaxed mb-5">
              يمكنك إعادة المحاولة أو العودة إلى الشاشة الرئيسية دون فقدان أي بيانات.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={() => {
                  this.setState({ hasError: false, errorMessage: '' });
                  window.location.hash = '#/';
                  window.location.reload();
                }}
                className="inline-flex items-center gap-2 bg-[#1B2A59] hover:bg-[#142047] text-[#F9E7B6] px-5 py-2.5 rounded-xl font-black text-xs shadow-md transition-all cursor-pointer"
              >
                <RotateCcw size={15} /> إعادة تحميل التطبيق
              </button>
              <button
                type="button"
                onClick={() => {
                  this.setState({ hasError: false, errorMessage: '' });
                  window.location.hash = '#/';
                }}
                className="inline-flex items-center gap-2 bg-amber-50 hover:bg-amber-100 text-[#1B2A59] border border-amber-300 px-4 py-2.5 rounded-xl font-black text-xs transition-all cursor-pointer"
              >
                <ArrowRight size={15} /> الصفحة الرئيسية
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// نظام الحماية والإجبار على التحديث
function UpdateChecker({ children }) {
  const [needsUpdate, setNeedsUpdate] = useState(false);
  const [downloadLink, setDownloadLink] = useState("");

  useEffect(() => {
    const checkVersionAndNotify = async () => {
      try {
        // 1. طلب تصريح الإشعارات
        if (Capacitor.isNativePlatform()) {
          await LocalNotifications.requestPermissions();
        }

        // 2. إشعار الترحيب وإشعار نجاح التحديث
        const hasSeenWelcome = localStorage.getItem('hasSeenWelcome');
        const lastSavedVersion = localStorage.getItem('lastSavedVersion');

        if (!hasSeenWelcome) {
          if (Capacitor.isNativePlatform()) {
            await LocalNotifications.schedule({
              notifications: [{
                title: "أهلاً بك في الخدمة",
                body: "نورت الأبلكيشن يا مخدوم، ربنا يبارك تعب محبتك.",
                id: 1,
                schedule: { at: new Date(Date.now() + 3000) },
                smallIcon: "ic_launcher"
              }]
            });
          }
          localStorage.setItem('hasSeenWelcome', 'true');
        } else if (lastSavedVersion && lastSavedVersion !== CURRENT_APP_VERSION) {
          if (Capacitor.isNativePlatform()) {
            await LocalNotifications.schedule({
              notifications: [{
                title: "تم التحديث بنجاح",
                body: `مبروك! إنت دلوقتي شغال بأحدث نسخة من الأبلكيشن (${CURRENT_APP_VERSION}).`,
                id: 2,
                schedule: { at: new Date(Date.now() + 2000) },
                smallIcon: "ic_launcher"
              }]
            });
          }
        }
        
        // حفظ رقم النسخة الحالية عشان المقارنة المرة الجاية
        localStorage.setItem('lastSavedVersion', CURRENT_APP_VERSION);

        // 3. مقارنة ذكية للأرقام (SemVer)
        const isNewVersionAvailable = (currentV, latestV) => {
          if (!latestV) return false;
          const currParts = currentV.split('.').map(Number);
          const latestParts = latestV.split('.').map(Number);
          
          for (let i = 0; i < Math.max(currParts.length, latestParts.length); i++) {
            const curr = currParts[i] || 0;
            const latest = latestParts[i] || 0;
            if (latest > curr) return true;
            if (latest < curr) return false;
          }
          return false;
        };

        // 4. فحص الفايربيز بدون كاش (Live Check) مع دعم السقوط على الكاش عند عدم وجود اتصال
        if (!firestore) return;
        const docRef = doc(firestore, "System", "AppConfig");
        let docSnap = null;

        if (navigator.onLine) {
            try {
                // محاولة جلب النسخة الحقيقية من السيرفر لتخطي النسخ المخبأة (Cache)
                docSnap = await getDocFromServer(docRef);
            } catch {
                try {
                    docSnap = await getDoc(docRef);
                } catch {
                    try {
                        docSnap = await getDocFromCache(docRef);
                    } catch {
                        // Document not in cache, ignore silently
                    }
                }
            }
        } else {
            // أوفلاين: افحص الكاش مباشرة بدون إرسال طلبات فاشلة للشبكة
            try {
                docSnap = await getDocFromCache(docRef);
            } catch {
                // ليس بالكاش، تجاهل بدون خطأ
            }
        }

        if (docSnap && docSnap.exists()) {
          const data = docSnap.data();
          // مقارنة دقيقة بدلاً من != العادية
          if (isNewVersionAvailable(CURRENT_APP_VERSION, data.latestVersion)) {
            setDownloadLink(data.updateLink || "");
            setNeedsUpdate(true); // اقفل الشاشة

            // ابعتله إشعار إن فيه تحديث
            if (Capacitor.isNativePlatform()) {
              await LocalNotifications.schedule({
                notifications: [{
                  title: "تحديث جديد متاح",
                  body: "نزلنا نسخة جديدة مهمة جداً، لازم تحدث الأبلكيشن عشان تكمل خدمة.",
                  id: 3,
                  schedule: { at: new Date(Date.now() + 1000) },
                  smallIcon: "ic_launcher"
                }]
              });
            }
          }
        }
      } catch (error) {
        // تجاهل أخطاء الأوفلاين الشائعة بدون رسائل تحذير مزعجة في الكونسول
        const isOffline = !navigator.onLine ||
          error?.code === 'unavailable' ||
          error?.message?.includes('offline') ||
          error?.message?.includes('Failed to get document because the client is offline');
        if (!isOffline) {
          console.warn("Notice checking updates:", error?.message || error);
        }
      }
    };

    checkVersionAndNotify();
  }, []);

  // لو محتاج تحديث، الشاشة دي هتقفل عليه الأبلكيشن تماماً
  if (needsUpdate) {
    return (
      <div className="fixed inset-0 z-[99999] coptic-cream-surface flex items-center justify-center p-4 text-center" dir="rtl">
        <div className="coptic-card p-8 rounded-[2.5rem] shadow-2xl max-w-sm w-full relative z-[100000]">
          <div className="w-24 h-24 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6 relative border border-red-200">
            <div className="absolute inset-0 bg-red-400 rounded-full animate-ping opacity-20"></div>
            <AlertTriangle size={48} strokeWidth={1.5} />
          </div>
          <h2 className="text-2xl font-black text-[#1B2A59] mb-3 flex justify-center items-center gap-2">
            تحديث هام جداً <Rocket className="text-[#C8942E]" size={24} />
          </h2>
          <p className="text-sm font-bold text-[#6E5233] mb-8 leading-relaxed">
            عشان نضمن سرعة الأبلكيشن وأمان بيانات المخدومين، نزلنا تحديث جديد. اضغط تحت للتحميل والتثبيت (التحديث مش هيمسح بياناتك).
          </p>
          <a
            href={downloadLink}
            target="_blank"
            rel="noreferrer"
            className="w-full bg-gradient-to-l from-[#1B2A59] to-[#233975] text-[#F9E7B6] py-4 rounded-xl font-black shadow-lg flex justify-center items-center gap-2 transition-all hover:opacity-95"
          >
            <Download size={20} /> تحميل التحديث الآن
          </a>
        </div>
      </div>
    );
  }

  // لو النسخة حديثة، افتحله الأبلكيشن عادي
  return children;
}


// حارس مسارات الخدام: يمنع الزوار وأولياء الأمور ونسخة ولي الأمر من الدخول لمسارات الخدمة
function ServantProtectedRoute({ children }) {
  const edition = getAppEdition();
  const scope = resolveUserAccessScope();
  if (edition === 'parent') return <Navigate to={scope.isParent ? '/parent-dashboard' : '/parent-login'} replace />;
  if (scope.isParent) return <Navigate to="/parent-dashboard" replace />;
  if (scope.isGuest) return <Navigate to="/login" replace />;
  return children;
}

// حارس مسارات القيادة (الكاهن / أمين الخدمة العام / أمين المرحلة - يمنع خادم الفصل ووضع التصفح ونسخة الخادم/ولي الأمر)
function LeaderRoute({ children }) {
  const edition = getAppEdition();
  const scope = resolveUserAccessScope();
  if (edition === 'parent') return <Navigate to={scope.isParent ? '/parent-dashboard' : '/parent-login'} replace />;
  if (scope.isParent) return <Navigate to="/parent-dashboard" replace />;
  if (scope.isGuest) return <Navigate to="/login" replace />;
  if (edition === 'servant' || !scope.canAccessMasterDashboard) return <Navigate to="/" replace />;
  return children;
}

// حارس مسار إدارة النظام العام (#/admin) - للكاهن وأمين الخدمة العام فقط
function SuperAdminRoute({ children }) {
  const edition = getAppEdition();
  const scope = resolveUserAccessScope();
  if (edition === 'parent') return <Navigate to={scope.isParent ? '/parent-dashboard' : '/parent-login'} replace />;
  if (scope.isParent) return <Navigate to="/parent-dashboard" replace />;
  if (scope.isGuest) return <Navigate to="/login" replace />;
  if (edition === 'servant' || !scope.canAccessSystemAdmin) {
    return <Navigate to={scope.canAccessMasterDashboard && edition !== 'servant' ? '/master-dashboard' : '/'} replace />;
  }
  return children;
}

// حارس بوابة ولي الأمر: في نسخة ولي الأمر يسمح لولي الأمر فقط، وفي الشاملة يسمح بمعاينة الخادم، ويُمنع في نسخ الأدمن/الخادم
function ParentRoute({ children }) {
  const edition = getAppEdition();
  const scope = resolveUserAccessScope();
  if ((edition === 'admin' || edition === 'servant') && !scope.isParent) {
    return <Navigate to={scope.isGuest ? '/login' : '/'} replace />;
  }
  if (edition === 'parent' && !scope.isParent) {
    return <Navigate to="/parent-login" replace />;
  }
  if (scope.isGuest && !readScopedStorage('parentChildId')) {
    return <Navigate to="/parent-login" replace />;
  }
  return children;
}

// حارس صفحة دخول الخدام وطلب الانضمام: يمنع نسخة ولي الأمر تماماً ويحولها لبوابة ولي الأمر
function AuthEntryRoute({ children }) {
  const edition = getAppEdition();
  const scope = resolveUserAccessScope();
  if (edition === 'parent' || scope.isParent) {
    return <Navigate to={scope.isParent ? '/parent-dashboard' : '/parent-login'} replace />;
  }
  return children;
}

// حارس صفحة دخول ولي الأمر: يمنع نسخ الأدمن والخادم من فتح بوابة ولي الأمر
function ParentLoginRoute({ children }) {
  const edition = getAppEdition();
  const scope = resolveUserAccessScope();
  if (edition === 'admin' || edition === 'servant') {
    return <Navigate to={scope.isGuest ? '/login' : '/'} replace />;
  }
  if (edition === 'parent' && scope.isParent) {
    return <Navigate to="/parent-dashboard" replace />;
  }
  return children;
}

function FallbackRoute() {
  const edition = getAppEdition();
  const scope = resolveUserAccessScope();
  if (edition === 'parent' || scope.isParent) {
    return <Navigate to={scope.isParent ? '/parent-dashboard' : '/parent-login'} replace />;
  }
  return <Navigate to={scope.isGuest ? '/login' : '/'} replace />;
}


function App() {
  const location = useLocation();
  const navigate = useNavigate();

  // Global network listener — auto-syncs when coming back online
  useNetworkStatus();

  // Real-time Firestore listener — propagates child deletions & changes instantly
  useChildrenRealtimeSync();

  // Production cleanup — removes any legacy demo/test records from local browser DB
  useEffect(() => {
    void purgeLocalDemoDataOnce();
  }, []);

  const [impersonatedOsra, setImpersonatedOsra] = useState(() => getImpersonatedOsra());
  const [, setAuthVersion] = useState(0);

  useEffect(() => {
    const refreshImpersonation = () => {
      setImpersonatedOsra(getImpersonatedOsra());
      setAuthVersion(v => v + 1);
      applyEditionBrandingToDOM();
    };
    window.addEventListener('syncKey-changed', refreshImpersonation);
    window.addEventListener('auth-changed', refreshImpersonation);
    window.addEventListener('edition-changed', refreshImpersonation);
    window.addEventListener('storage', refreshImpersonation);
    return () => {
      window.removeEventListener('syncKey-changed', refreshImpersonation);
      window.removeEventListener('auth-changed', refreshImpersonation);
      window.removeEventListener('edition-changed', refreshImpersonation);
      window.removeEventListener('storage', refreshImpersonation);
    };
  }, []);

  const accessScope = resolveUserAccessScope();
  useEffect(() => {
    applyEditionBrandingToDOM(accessScope.roleTier);
  }, [accessScope.roleTier, location.pathname]);
  const isAuthenticated = !accessScope.isGuest && !accessScope.isParent;

  // الشروط بتاعة الشريط السفلي (BottomNav)
  const hideBottomNavPages = [
    '/dashboard', '/login', '/signup', '/admin', '/pdf-viewer', '/master-dashboard', '/info-directory', '/directory',
    '/calendar', '/add-event', '/parent-login', '/parent-dashboard', '/qr-scan', '/qr-attendance', '/generate-cards',
    '/master-logs', '/audit-logs', '/servant-profile', '/my-profile',
    '/servants-report', '/admin/servants-report', '/admin/servants-followup', '/servants-follow-up'
  ];
  const isEventDetailsPage = location.pathname.startsWith('/event/');

  const showBottomNav = isAuthenticated && !hideBottomNavPages.includes(location.pathname) && !isEventDetailsPage;

  // الشروط بتاعة الفوتر (Footer)
  const showFooter = isAuthenticated && ['/', '/admin', '/dashboard', '/master-dashboard', '/points', '/curriculum'].includes(location.pathname);

  const isSuperAdminImpersonating = Boolean(impersonatedOsra?.syncKey) && !accessScope.isParent && !accessScope.isGuest;
  const assignedOsra = impersonatedOsra?.name || readScopedStorage('assignedOsra') || 'الأسرة المحددة';

  const handleExitImpersonation = () => {
    const restoredKey = exitOsraImpersonation();
    setImpersonatedOsra(null);
    navigate(restoredKey === 'STAGE_ADMIN' ? '/master-dashboard' : '/');
  };

  return (
    <UpdateChecker>
      <BackButtonHandler />
      <NotificationManager />
      <ScrollToTop />
      <GlobalSyncBadge />
      
      {/* Escape Hatch Banner for Super Admin / Stage Leader Impersonation */}
      {isSuperAdminImpersonating && (
        <div className="bg-gradient-to-r from-red-700 to-red-900 text-white p-3 shadow-lg flex flex-col sm:flex-row items-center justify-between gap-3 z-[9999] relative">
            <div className="flex items-center gap-2 font-black text-sm text-center sm:text-right">
                <AlertTriangle size={18} className="text-amber-300" />
                أنت الآن تتصفح بيانات ({assignedOsra}) بصلاحية خادم فصل فقط
            </div>
            <button onClick={handleExitImpersonation} className="inline-flex items-center gap-1.5 bg-[#FFFBF2] text-red-800 px-4 py-1.5 rounded-full text-xs font-black shadow-md hover:bg-amber-50 transition-colors shrink-0 cursor-pointer">
                <ArrowRight size={14} /> إنهاء التصفح والعودة للوضع الإداري
            </button>
        </div>
      )}

      <AppErrorBoundary key={location.pathname}>
        <Routes>
          {/* مسارات الدخول العامة */}
          <Route path="/login" element={<AuthEntryRoute><Login /></AuthEntryRoute>} />
          <Route path="/parent-login" element={<ParentLoginRoute><ParentLogin /></ParentLoginRoute>} />
          <Route path="/signup" element={<AuthEntryRoute><SignUp /></AuthEntryRoute>} />

          {/* مسارات الخدام المحمية */}
          <Route path="/" element={<ServantProtectedRoute><Home /></ServantProtectedRoute>} />
          <Route path="/attendance" element={<ServantProtectedRoute><Attendance /></ServantProtectedRoute>} />
          <Route path="/tracking-dashboards" element={<LeaderRoute><TrackingDashboards /></LeaderRoute>} />
          <Route path="/visitation" element={<ServantProtectedRoute><Visitation /></ServantProtectedRoute>} />
          <Route path="/exams" element={<ServantProtectedRoute><ExamsManager /></ServantProtectedRoute>} />
          <Route path="/info-directory" element={<ServantProtectedRoute><InfoDirectory /></ServantProtectedRoute>} />
          <Route path="/directory" element={<ServantProtectedRoute><Navigate to="/info-directory" replace /></ServantProtectedRoute>} />

          <Route path="/dashboard" element={<ServantProtectedRoute><Dashboard /></ServantProtectedRoute>} />
          <Route path="/servant-profile" element={<ServantProtectedRoute><ServantProfile /></ServantProtectedRoute>} />
          <Route path="/my-profile" element={<ServantProtectedRoute><ServantProfile /></ServantProtectedRoute>} />
          <Route path="/servant-checkin" element={<ServantProtectedRoute><ServantSelfCheckIn /></ServantProtectedRoute>} />
          <Route path="/profile/:id" element={<ServantProtectedRoute><ChildProfile /></ServantProtectedRoute>} />
          <Route path="/info/:id" element={<ServantProtectedRoute><ChildInfo /></ServantProtectedRoute>} />

          <Route path="/hierarchy" element={<LeaderRoute><ChurchHierarchy /></LeaderRoute>} />
          <Route path="/admin" element={<SuperAdminRoute><SystemAdmin /></SuperAdminRoute>} />
          <Route path="/admin/servants-followup" element={<LeaderRoute><ServantsFollowUp /></LeaderRoute>} />
          <Route path="/servants-follow-up" element={<LeaderRoute><Navigate to="/admin/servants-followup" replace /></LeaderRoute>} />
          <Route path="/admin/servants-report" element={<LeaderRoute><ServantsMonthlyReport /></LeaderRoute>} />
          <Route path="/servants-report" element={<LeaderRoute><ServantsMonthlyReport /></LeaderRoute>} />

          {/* مسارات المهام والأجندة */}
          <Route path="/calendar" element={<ServantProtectedRoute><CalendarPage /></ServantProtectedRoute>} />
          <Route path="/add-event" element={<ServantProtectedRoute><AddEventPage /></ServantProtectedRoute>} />
          <Route path="/event/:id" element={<ServantProtectedRoute><EventDetailsPage /></ServantProtectedRoute>} />

          {/* QR Scanner PoC & Production */}
          <Route path="/qr-scan" element={<ServantProtectedRoute><QrScannerPoC /></ServantProtectedRoute>} />
          <Route path="/qr-attendance" element={<ServantProtectedRoute><QrAttendance /></ServantProtectedRoute>} />
          <Route path="/generate-cards" element={<ServantProtectedRoute><QrCardGenerator /></ServantProtectedRoute>} />

          {/* نظام النقاط والمكافآت والمناهج */}
          <Route path="/points" element={<ServantProtectedRoute><PointsLeaderboard /></ServantProtectedRoute>} />
          <Route path="/curriculum" element={<ServantProtectedRoute><CurriculumManager /></ServantProtectedRoute>} />

          {/* بوابة أولياء الأمور ونتائج الطلاب */}
          <Route path="/parent-dashboard" element={<ParentRoute><ParentDashboard /></ParentRoute>} />

          {/* صفحات عامة */}
          <Route path="/pdf-viewer" element={<PdfViewer />} />
          <Route path="/master-dashboard" element={<LeaderRoute><MasterDashboard /></LeaderRoute>} />
          <Route path="/master-logs" element={<SuperAdminRoute><MasterActivityLogs /></SuperAdminRoute>} />
          <Route path="/audit-logs" element={<SuperAdminRoute><MasterActivityLogs /></SuperAdminRoute>} />
          <Route path="*" element={<FallbackRoute />} />
        </Routes>
      </AppErrorBoundary>

      {/* إظهار الفوتر والشريط السفلي بناءً على الشروط */}
      {showFooter && <Footer compact={location.pathname !== '/'} />}
      {showBottomNav && <BottomNav />}
    </UpdateChecker>
  );
}

export default App;