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

  it('keeps the live region mounted while empty, so the message is announced when it appears', () => {
    const { rerender } = render(<Alert tone="success">{false}</Alert>);

    const region = screen.getByRole('status');
    expect(region).toBeEmptyDOMElement();

    rerender(<Alert tone="success">Profil mis à jour</Alert>);
    expect(screen.getByRole('status')).toBe(region);
    expect(region).toHaveTextContent('Profil mis à jour');
  });
});
