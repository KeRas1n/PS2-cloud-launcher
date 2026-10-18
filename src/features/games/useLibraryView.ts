import { useState } from 'react';
import type { Library } from '../../../shared/types';
export function useLibraryView(library: Library) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All games');
  const [compact, setCompact] = useState(false);
  const games = library.games.filter(
    (g) =>
      g.title.toLowerCase().includes(query.toLowerCase()) &&
      (filter === 'All games' || (filter === 'Installed' ? !!g.localPath : g.state === 'Cloud Only')),
  );
  const localCount = library.games.filter((g) => g.localPath).length;
  const cloudCount = library.games.filter((g) => g.cloudPath).length;

  return { query, setQuery, filter, setFilter, compact, setCompact, games, localCount, cloudCount };
}
