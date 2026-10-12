import type { ReactNode } from 'react';
import { CheckCircleIcon, InfoIcon, WarningCircleIcon, type Icon } from '@phosphor-icons/react';

export type AlertTone = 'error' | 'success' | 'info';

export type AlertProps = {
  tone?: AlertTone;
  // Overrides the tone icon, e.g. an envelope for "an activation link will be sent"
  icon?: Icon;
  children: ReactNode;
};

const ICONS: Record<AlertTone, Icon> = {
  error: WarningCircleIcon,
  success: CheckCircleIcon,
  info: InfoIcon,
};

// Inline message as in the prototype: one icon + text line, never color alone.
// An error interrupts the screen reader, other tones wait their turn.
function Alert({ tone = 'info', icon, children }: AlertProps) {
  const ToneIcon = icon ?? ICONS[tone];

  return (
    <p className={`alert alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <ToneIcon size={16} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

export default Alert;
