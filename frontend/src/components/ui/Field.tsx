import { useId, type ReactNode } from 'react';
import { WarningCircleIcon } from '@phosphor-icons/react';

// Attributes to spread on the control to link it to its label, hint and error
export type FieldControlProps = {
  id: string;
  required?: boolean;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
};

export type FieldProps = {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  id?: string;
  children: (control: FieldControlProps) => ReactNode;
};

// Shared field wrapper: associated label, hint and error announced with the control
function Field({ label, hint, error, required, id, children }: FieldProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="field">
      <label htmlFor={controlId}>
        {label}
        {/* The asterisk is visual only; `required` on the control already announces it */}
        {required && (
          <span className="field-required" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children({
        id: controlId,
        required,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })}
      {hint && (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="field-error">
          <WarningCircleIcon size={16} aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

export default Field;
