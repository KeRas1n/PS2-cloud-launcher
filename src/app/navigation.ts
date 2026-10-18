import { Cloud, Gamepad2, MonitorDown, Settings2 } from 'lucide-react';
export type SettingsTab = 'Games' | 'Emulator' | 'Cloud';
export const settingsTabs: SettingsTab[] = ['Games', 'Emulator', 'Cloud'];
export type Page = SettingsTab | 'Settings' | 'Downloads';
export const navigation = [
  { name: 'Games', icon: Gamepad2 },
  { name: 'Emulator', icon: MonitorDown },
  { name: 'Cloud', icon: Cloud },
  { name: 'Settings', icon: Settings2 },
] as const;
