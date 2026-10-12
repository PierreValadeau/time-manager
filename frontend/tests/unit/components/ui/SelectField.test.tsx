import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SelectField from '../../../../src/components/ui/SelectField';
import { expectNoA11yViolations } from './axe';

const ROLES = [
  { value: 'employee', label: 'Employé' },
  { value: 'manager', label: 'Manager' },
];

describe('SelectField', () => {
  it('associates the label with a native select', async () => {
    const { container } = render(<SelectField label="Rôle" options={ROLES} />);

    const select = screen.getByRole('combobox', { name: 'Rôle' });
    expect(screen.getAllByRole('option')).toHaveLength(2);
    await userEvent.selectOptions(select, 'manager');
    expect(select).toHaveValue('manager');
    await expectNoA11yViolations(container);
  });

  it('announces the error', () => {
    render(<SelectField label="Équipe" options={ROLES} error="Choisissez une équipe" />);

    const select = screen.getByRole('combobox', { name: 'Équipe' });
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAccessibleDescription('Choisissez une équipe');
  });
});
