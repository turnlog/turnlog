import { useEffect, type ReactNode } from 'react';
import './Overlay.css';

/**
 * Shared scrim for centered overlays (palette, shortcuts sheet, media
 * viewer): closes on backdrop click and on Escape, so every overlay
 * dismisses the same way. `center` seats the surface mid-screen instead of
 * near the top, for content whose size is not text.
 */
export default function Overlay({
  onClose,
  center = false,
  children,
}: {
  onClose: () => void;
  center?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className={`overlay ${center ? 'center' : ''}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {children}
    </div>
  );
}
