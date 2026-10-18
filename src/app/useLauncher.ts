import { useContext } from 'react';
import { LauncherContext } from './LauncherProvider';

export function useLauncher() {
  const launcher = useContext(LauncherContext);
  if (!launcher) throw new Error('LauncherProvider is missing.');
  return launcher;
}
