const paths = {
  history: 'M3 11a9 9 0 1 1 2 7 M3 4v7h7 M12 7v5l3 2',
  board: 'M3 3h18v18H3z M9 3v18 M15 3v18 M3 9h18 M3 15h18',
  ACTION: 'm13 2-9 12h7l-1 8 10-12h-7l1-8Z',
  REWARD: 'M3 8h18v4H3z M5 12v9h14v-9 M12 8v13 M12 8H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z',
  RACE_STRENGTH: 'M3 14a9 9 0 0 1 18 0v4H5l-2-4Zm18 0H11l2 4 M6 21h12',
  PIT_STOP: 'm14 6 4-4a6 6 0 0 0-8 7L3 16a3 3 0 0 0 5 5l7-7a6 6 0 0 0 7-8l-4 4-4-4Z',
  INDISIPLINER: 'm12 3 10 18H2L12 3Zm0 6v5 M12 17v.5',
  effects: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
  flag: 'M4 22V3h16v11H4 M4 3l16 11 M20 3 4 14',
  trophy: 'M7 3h10v7a5 5 0 0 1-10 0V3Zm0 2H3v3a4 4 0 0 0 4 4 M17 5h4v3a4 4 0 0 1-4 4 M12 15v6 M8 21h8'
};

/** Decorative, consistently stroked icons supplement the visible labels and category colors. */
export function Icon({ name, className = '' }) {
  return (
    <svg className={`ui-icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={paths[name] || paths.flag} />
    </svg>
  );
}
