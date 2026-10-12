import type { ReactNode } from 'react';
import { CheckCircleIcon, InfoIcon, WarningCircleIcon, type Icon } from '@phosphor-icons/react';

export type AlertTone = 'error' | 'success' | 'info';

export type AlertProps = {
  tone?: AlertTone;
  title?: ReactNode;
  children: ReactNode;
};

const ICONS: Record<AlertTone, Icon> = {
  error: WarningCircleIcon,
  success: CheckCircleIcon,
  info: InfoIcon,
};

// Inline message: an error interrupts the screen reader, other tones wait their turn
function Alert({ tone = 'info', title, children }: AlertProps) {
  const ToneIcon = ICONS[tone];

  return (
    <div className={`alert alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <ToneIcon size={18} aria-hidden="true" />
      <div>
        {title && <p className="alert-title">{title}</p>}
        <div>{children}</div>
      </div>
    </div>
  );
}

export default Alert;
