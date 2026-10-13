import type { ComponentPropsWithRef } from 'react';

type BaseProps = ComponentPropsWithRef<'button'> & {
  // Blocks clicks and announces the button as busy while a request runs
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
  onClick,
  ...rest
}: ButtonProps) {
  const classes = ['btn', `btn-${variant}`, block && 'btn-block', className].filter(Boolean).join(' ');

  return (
    <button
      {...rest}
      type={type}
      className={classes}
      disabled={disabled}
      // aria-disabled rather than disabled: the button keeps keyboard focus during the request
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      onClick={loading ? (event) => event.preventDefault() : onClick}
    >
      {children}
    </button>
  );
}

export default Button;
