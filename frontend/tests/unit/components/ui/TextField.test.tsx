import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TextField from '../../../../src/components/ui/TextField';
import { expectNoA11yViolations } from './axe';

describe('TextField', () => {
  it('associates the label with the input', async () => {
    const { container } = render(<TextField label="Email" type="email" name="email" />);

    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
    await expectNoA11yViolations(container);
  });

  it('links the hint to the input', () => {
    render(<TextField label="Téléphone" hint="Format 06 12 34 56 78" />);

    expect(screen.getByLabelText('Téléphone')).toHaveAccessibleDescription('Format 06 12 34 56 78');
  });

  it('marks the input invalid and announces the error along with the hint', async () => {
    const { container } = render(<TextField label="Mot de passe" hint="12 caractères minimum" error="Trop court" />);

    const input = screen.getByLabelText('Mot de passe');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('12 caractères minimum Trop court');
    await expectNoA11yViolations(container);
  });

  it('adds no extra ARIA attributes without hint or error', () => {
    render(<TextField label="Prénom" />);

    const input = screen.getByLabelText('Prénom');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-describedby');
  });

  it('marks the input as required, with a visible asterisk kept out of its name', async () => {
    const { container } = render(<TextField label="Nom" required />);

    expect(screen.getByRole('textbox', { name: 'Nom' })).toBeRequired();
    expect(container.querySelector('label')).toHaveTextContent('Nom *');
    await expectNoA11yViolations(container);
  });

  it('keeps the aria-describedby given by the parent alongside hint and error', () => {
    render(
      <>
        <p id="password-rules">Une majuscule et un chiffre</p>
        <TextField label="Mot de passe" aria-describedby="password-rules" hint="12 caractères minimum" error="Trop court" />
      </>,
    );

    expect(screen.getByLabelText('Mot de passe')).toHaveAccessibleDescription(
      'Une majuscule et un chiffre 12 caractères minimum Trop court',
    );
  });

  it('keeps a provided id', () => {
    render(<TextField label="Email" id="login-email" />);

    expect(screen.getByLabelText('Email')).toHaveAttribute('id', 'login-email');
  });
});
