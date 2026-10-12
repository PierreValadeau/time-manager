import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import Table, { type TableColumn } from '../../../../src/components/ui/Table';
import { expectNoA11yViolations } from './axe';

type Day = { date: string; total: string; status: string };

const COLUMNS: TableColumn<Day>[] = [
  { key: 'date', header: 'Jour', render: (d) => d.date },
  { key: 'total', header: 'Total', render: (d) => d.total, align: 'end' },
  { key: 'status', header: 'Statut', render: (d) => d.status, secondary: true },
];

const DAYS: Day[] = [
  { date: 'Lun. 5', total: '7 h 30', status: 'Complet' },
  { date: 'Mar. 6', total: '6 h 10', status: 'Incomplet' },
];

describe('Table', () => {
  it('names the table by its caption and declares column headers', async () => {
    const { container } = render(<Table caption="Mes heures" columns={COLUMNS} rows={DAYS} getRowKey={(d) => d.date} />);

    const table = screen.getByRole('table', { name: 'Mes heures' });
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual(['Jour', 'Total', 'Statut']);
    headers.forEach((h) => expect(h).toHaveAttribute('scope', 'col'));
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    await expectNoA11yViolations(container);
  });

  it('makes the scroll container reachable with the keyboard', () => {
    render(<Table caption="Mes heures" columns={COLUMNS} rows={DAYS} getRowKey={(d) => d.date} />);

    expect(screen.getByRole('region', { name: 'Mes heures' })).toHaveAttribute('tabindex', '0');
  });

  it('hides the caption visually by default but keeps it for screen readers', () => {
    render(<Table caption="Mes heures" columns={COLUMNS} rows={DAYS} getRowKey={(d) => d.date} />);

    expect(screen.getByRole('table', { name: 'Mes heures' }).querySelector('caption')).toHaveClass('visually-hidden');
  });

  it('can show the caption', () => {
    render(<Table caption="Mes heures" showCaption columns={COLUMNS} rows={DAYS} getRowKey={(d) => d.date} />);

    expect(screen.getByRole('table', { name: 'Mes heures' }).querySelector('caption')).not.toHaveClass('visually-hidden');
  });

  it('applies alignment and mobile hiding to headers and cells alike', () => {
    render(<Table caption="Mes heures" columns={COLUMNS} rows={DAYS} getRowKey={(d) => d.date} />);

    expect(screen.getByRole('columnheader', { name: 'Total' })).toHaveClass('align-end');
    expect(screen.getByRole('cell', { name: '7 h 30' })).toHaveClass('align-end');
    expect(screen.getByRole('columnheader', { name: 'Statut' })).toHaveClass('col-secondary');
    expect(screen.getByRole('cell', { name: 'Complet' })).toHaveClass('col-secondary');
  });

  it('shows a full-width message when there are no rows', () => {
    render(<Table caption="Mes heures" columns={COLUMNS} rows={[]} getRowKey={(d) => d.date} emptyMessage="Aucun pointage" />);

    expect(screen.getByRole('cell', { name: 'Aucun pointage' })).toHaveAttribute('colspan', '3');
  });
});
