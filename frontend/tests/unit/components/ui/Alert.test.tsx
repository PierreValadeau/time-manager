import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Alert from '../../../../src/components/ui/Alert';
import { expectNoA11yViolations } from './axe';

describe('Alert', () => {
  it('interrupts the screen reader for an error', async () => {
    const { container } = render(
      <Alert tone="error">Email ou mot de passe incorrect</Alert>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Email ou mot de passe incorrect');
    await expectNoA11yViolations(container);
  });

  it.each(['success', 'info'] as const)('politely announces a %s message', (tone) => {
    render(<Alert tone={tone}>Profil mis à jour</Alert>);

    expect(screen.getByRole('status')).toHaveTextContent('Profil mis à jour');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
