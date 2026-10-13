import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import ToastProvider, { TOAST_DURATION_MS } from '../../../../src/components/ui/ToastProvider';
import { useToast } from '../../../../src/components/ui/toast-context';
import Button from '../../../../src/components/ui/Button';

function ClockButton() {
  const showToast = useToast();
  return <Button onClick={() => showToast('Arrivée enregistrée à 09:02')}>Pointer</Button>;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Toast', () => {
  it('announces the message in an already mounted live region, then clears it', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <ClockButton />
      </ToastProvider>,
    );

    const region = screen.getByRole('status');
    expect(region).toBeEmptyDOMElement();

    act(() => screen.getByRole('button').click());
    expect(region).toHaveTextContent('Arrivée enregistrée à 09:02');

    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS));
    expect(region).toBeEmptyDOMElement();
  });

  it('restarts the timer when a new message arrives', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <ClockButton />
      </ToastProvider>,
    );

    act(() => screen.getByRole('button').click());
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS - 100));
    act(() => screen.getByRole('button').click());
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByRole('status')).toHaveTextContent('Arrivée enregistrée');
  });

  it('throws when used outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useToast())).toThrow('ToastProvider');
  });
});
