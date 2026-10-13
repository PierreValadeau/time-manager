import type { ComponentPropsWithRef, ReactNode } from 'react';
import Field from './Field';

export type TextFieldProps = Omit<ComponentPropsWithRef<'input'>, 'id'> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  id?: string;
};

function TextField({ label, hint, error, required, id, className, 'aria-describedby': describedBy, ...rest }: TextFieldProps) {
  return (
    <Field label={label} hint={hint} error={error} required={required} id={id} describedBy={describedBy}>
      {(control) => <input {...rest} {...control} className={['input', className].filter(Boolean).join(' ')} />}
    </Field>
  );
}

export default TextField;
