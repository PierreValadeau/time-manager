import type { ComponentPropsWithRef } from 'react';
import { CircleNotchIcon } from '@phosphor-icons/react';

type BaseProps = ComponentPropsWithRef<'button'> & {
  // Disables the button and announces it as busy while a request runs
  loading?: boolean;
  block?: boolean;
};

// An icon button has no visible text, so its accessible name is mandatory
export type ButtonProps =
  | (BaseProps & { variant?: 'primary' | 'secondary' | 'ghost' })
  | (BaseProps & { variant: 'icon'; 'aria-label': string });

function Button({
  variant = 'primary',
  loading = false,
  block = false,
  type = 'button',
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const classes = ['btn', `btn-${variant}`, block && 'btn-block', className].filter(Boolean).join(' ');

  return (
    <button
      {...rest}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && <CircleNotchIcon size={16} className="spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

export default Button;
