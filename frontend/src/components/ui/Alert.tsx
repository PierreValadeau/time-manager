import type { ReactNode } from 'react';
import { CheckCircleIcon, InfoIcon, WarningCircleIcon, type Icon } from '@phosphor-icons/react';

export type AlertTone = 'error' | 'success' | 'info';

export type AlertProps = {
  tone?: AlertTone;
  // Overrides the tone icon, e.g. an envelope for "an activation link will be sent"
  icon?: Icon;
  // Empty content renders only the live region (see below)
  children?: ReactNode;
};

const ICONS: Record<AlertTone, Icon> = {
  error: WarningCircleIcon,
  success: CheckCircleIcon,
  info: InfoIcon,
};

// Inline message as in the prototype: one icon + text line, never color alone.
// An error interrupts the screen reader, other tones wait their turn.
// Screen readers often skip a live region inserted already filled: keep the Alert mounted
// and change its content, e.g. <Alert tone="success">{saved && 'Profil mis à jour'}</Alert>
function Alert({ tone = 'info', icon, children }: AlertProps) {
  const ToneIcon = icon ?? ICONS[tone];
  const hasContent = children !== undefined && children !== null && children !== false && children !== '';

  return (
    <div role={tone === 'error' ? 'alert' : 'status'}>
      {hasContent && (
        <p className={`alert alert-${tone}`}>
          <ToneIcon size={16} aria-hidden="true" />
          <span>{children}</span>
        </p>
      )}
    </div>
  );
}

export default Alert;
