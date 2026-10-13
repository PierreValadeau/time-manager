import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

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
  // Table title for screen readers; hidden by default since the prototype shows an h2 above the table
  caption: string;
  showCaption?: boolean;
  columns: TableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  emptyMessage?: ReactNode;
};

function cellClass(column: Pick<TableColumn<unknown>, 'align' | 'secondary'>): string | undefined {
  return [column.align === 'end' && 'align-end', column.secondary && 'col-secondary'].filter(Boolean).join(' ') || undefined;
}

function Table<T>({ caption, showCaption = false, columns, rows, getRowKey, emptyMessage = 'Aucune donnée' }: TableProps<T>) {
  const captionId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);

  // Tracks overflow when the container or the table resizes (window, new rows); fires once on observe()
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setScrollable(element.scrollWidth > element.clientWidth));
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, []);

  return (
    // Focusable only when the table is wider than its container, so it can be scrolled with the keyboard
    // without adding a useless tab stop otherwise
    <div
      ref={scrollRef}
      className="table-scroll"
      role="region"
      aria-labelledby={captionId}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={scrollable ? 0 : undefined}
    >
      <table className="table">
        <caption id={captionId} className={showCaption ? undefined : 'visually-hidden'}>
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
