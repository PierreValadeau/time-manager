import type { ComponentPropsWithRef, ReactNode } from 'react';
import Field from './Field';

export type SelectOption = { value: string; label: string };

export type SelectFieldProps = Omit<ComponentPropsWithRef<'select'>, 'id' | 'children'> & {
  label: ReactNode;
  options: SelectOption[];
  hint?: ReactNode;
  error?: ReactNode;
  id?: string;
};

// Native select: keyboard, screen readers and mobile pickers work out of the box
function SelectField({ label, options, hint, error, required, id, className, ...rest }: SelectFieldProps) {
  return (
    <Field label={label} hint={hint} error={error} required={required} id={id}>
      {(control) => (
        <select {...rest} {...control} className={['input', className].filter(Boolean).join(' ')}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export default SelectField;
