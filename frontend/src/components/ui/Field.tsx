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
  // Descriptions provided by the parent, kept alongside the hint and error
  describedBy?: string;
  children: (control: FieldControlProps) => ReactNode;
};

// Shared field wrapper: associated label, hint and error announced with the control.
// A required field shows an asterisk: render <RequiredFieldsNote /> once in the form to explain it (WCAG 3.3.2)
function Field({ label, hint, error, required, id, describedBy: parentDescribedBy, children }: FieldProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [parentDescribedBy, hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="field">
      <label htmlFor={controlId}>
        {label}
        {/* Screen readers already get the required state from the control */}
        {required && (
          <span className="field-required" aria-hidden="true">
            {' '}*
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

// Explains the asterisk, to place at the top of any form with a required field
export function RequiredFieldsNote() {
  return (
    <p className="field-hint">
      Les champs marqués d’un <span className="field-required">*</span> sont obligatoires.
    </p>
  );
}

export default Field;
