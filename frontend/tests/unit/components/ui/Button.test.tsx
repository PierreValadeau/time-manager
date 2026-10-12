import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TrashIcon } from '@phosphor-icons/react';
import Button from '../../../../src/components/ui/Button';
import { expectNoA11yViolations } from './axe';

describe('Button', () => {
  it('renders a native button with type button by default, so it never submits a form by accident', () => {
    render(<Button>Enregistrer</Button>);

    const button = screen.getByRole('button', { name: 'Enregistrer' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('btn', 'btn-primary');
  });

  it('can be triggered with the keyboard', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Pointer</Button>);

    await userEvent.tab();
    expect(screen.getByRole('button')).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('is disabled and announced as busy while loading', () => {
    render(<Button loading>Connexion</Button>);

    const button = screen.getByRole('button', { name: 'Connexion' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('gives the icon button an accessible name', async () => {
    const { container } = render(
      <Button variant="icon" aria-label="Supprimer l’équipe">
        <TrashIcon size={18} aria-hidden="true" />
      </Button>,
    );

    expect(screen.getByRole('button', { name: 'Supprimer l’équipe' })).toHaveClass('btn-icon');
    await expectNoA11yViolations(container);
  });
});
