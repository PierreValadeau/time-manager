import { useId, type ReactNode } from 'react';

export type TableColumn<T> = {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  // Amounts and durations: right-aligned so figures can be compared
  align?: 'start' | 'end';
  // Column hidden on mobile, like Pause and Statut in the prototype
  secondary?: boolean;
};

export type TableProps<T> = {
  // Table title announced by screen readers; can be hidden when already shown nearby
  caption: string;
  hideCaption?: boolean;
  columns: TableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  emptyMessage?: ReactNode;
};

function cellClass(column: Pick<TableColumn<unknown>, 'align' | 'secondary'>): string | undefined {
  return [column.align === 'end' && 'align-end', column.secondary && 'col-secondary'].filter(Boolean).join(' ') || undefined;
}

function Table<T>({ caption, hideCaption = false, columns, rows, getRowKey, emptyMessage = 'Aucune donnée' }: TableProps<T>) {
  const captionId = useId();

  return (
    // Focusable region: a table wider than the screen must be scrollable with the keyboard
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div className="table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
      <table className="table">
        <caption id={captionId} className={hideCaption ? 'visually-hidden' : undefined}>
          {caption}
        </caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={cellClass(column)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="table-empty">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={getRowKey(row)}>
                {columns.map((column) => (
                  <td key={column.key} className={cellClass(column)}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default Table;
