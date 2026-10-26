import { useEffect, useState } from 'react';

const timeFormat = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });

// 09:02
export function formatTime(date: Date | string): string {
  return timeFormat.format(new Date(date));
}

// 24 octobre
export function formatDay(date: Date | string): string {
  return dayFormat.format(new Date(date));
}

// 7h05, as in the prototype
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.floor(minutes));
  return `${Math.floor(total / 60)}h${String(total % 60).padStart(2, '0')}`;
}

// Local day as YYYY-MM-DD, the format of the from/to query parameters
export function localDay(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

// Current time, refreshed every intervalMs
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
