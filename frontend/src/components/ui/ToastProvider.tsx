import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckCircleIcon } from '@phosphor-icons/react';
import { ToastContext } from './toast-context';

// Display duration from the prototype
export const TOAST_DURATION_MS = 2600;

function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showToast = useCallback((next: string) => {
    clearTimeout(timer.current);
    setMessage(next);
    timer.current = setTimeout(() => setMessage(null), TOAST_DURATION_MS);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <ToastContext value={showToast}>
      {children}
      {/* Live region always mounted: screen readers only announce what changes inside it */}
      <div className="toast-region" role="status">
        {message && (
          <div className="toast">
            <CheckCircleIcon size={18} aria-hidden="true" />
            {message}
          </div>
        )}
      </div>
    </ToastContext>
  );
}

export default ToastProvider;
