import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import useSmartNavigation from '../hooks/useSmartNavigation';
import { getImpersonatedOsra, exitOsraImpersonation } from '../utils/notificationScopeEngine';

export default function BackButtonHandler() {
  const { goBack } = useSmartNavigation();
  const location = useLocation();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let listener = null;

    CapacitorApp.addListener('backButton', () => {
      // If currently impersonating on home screen, exit impersonation first
      if (location.pathname === '/' || location.pathname === '') {
        const impersonating = getImpersonatedOsra();
        if (impersonating) {
          exitOsraImpersonation();
          window.dispatchEvent(new Event('syncKey-changed'));
          window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
          return;
        }
        CapacitorApp.exitApp();
        return;
      }

      // Otherwise navigate back smartly up the hierarchy
      goBack();
    }).then(l => {
        listener = l;
    });

    return () => {
      if (listener) {
        listener.remove();
      }
    };
  }, [location.pathname, goBack]);

  return null;
}
