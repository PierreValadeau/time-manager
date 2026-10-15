import { createContext, useContext } from 'react';

export type ShowToast = (message: string) => void;

export const ToastContext = createContext<ShowToast | null>(null);

// Short confirmation after an action ("Arrivée enregistrée à 09:02")
export function useToast(): ShowToast {
  const showToast = useContext(ToastContext);
  if (!showToast) {
    throw new Error('useToast must be used within a <ToastProvider>');
  }
  return showToast;
}
