import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Download, X } from 'lucide-react';
import { arabicNumber } from '../lib/quran';
import {
  checkForUpdate,
  snoozeUpdate,
  UPDATE_EVENT,
  type UpdateInfo,
} from '../lib/update';

export function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let alive = true;
    const onUpdate = (event: Event) => {
      if (alive) setUpdate((event as CustomEvent<UpdateInfo | null>).detail);
    };
    window.addEventListener(UPDATE_EVENT, onUpdate);
    void checkForUpdate().then((info) => {
      if (alive) setUpdate(info);
    });
    return () => {
      alive = false;
      window.removeEventListener(UPDATE_EVENT, onUpdate);
    };
  }, []);

  if (!update || hidden) return null;

  const isAndroid = Capacitor.getPlatform() === 'android';
  const url = isAndroid && update.downloadUrl ? update.downloadUrl : update.releaseUrl;
  const action = isAndroid && update.downloadUrl ? 'تنزيل APK' : 'عرض الإصدار';

  const open = () => {
    window.open(url, isAndroid ? '_system' : '_blank', 'noopener,noreferrer');
  };

  const later = () => {
    setHidden(true);
    snoozeUpdate();
  };

  return (
    <div className="update-banner" role="status">
      <span className="update-banner-icon" aria-hidden>
        <Download size={18} />
      </span>
      <span className="update-banner-copy">
        <strong>توجد نسخة جديدة</strong>
        <small className="muted">
          الإصدار {arabicNumber(update.version)} متاح الآن. بياناتك محفوظة على جهازك.
        </small>
      </span>
      <span className="update-banner-actions">
        <button className="btn btn-primary btn-sm" type="button" onClick={open}>
          {action}
        </button>
        <button
          className="update-banner-close"
          type="button"
          onClick={later}
          aria-label="تأجيل التذكير"
        >
          <X size={17} aria-hidden />
        </button>
      </span>
    </div>
  );
}
