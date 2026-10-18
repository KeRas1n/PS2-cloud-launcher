import type { Settings } from '../../../shared/types';
import { useLauncher } from '../../app/useLauncher';
import { PathField } from '../../components/PathField';

type StringSetting = { [K in keyof Settings]: Settings[K] extends string ? K : never }[keyof Settings];

export function SettingsPathField({
  label,
  setting,
  help,
  kind,
}: {
  label: string;
  setting: StringSetting;
  help: string;
  kind?: 'directory' | 'executable';
}) {
  const { draft, update, disabled, pickSetting, setError } = useLauncher();
  return (
    <PathField
      label={label}
      value={draft?.[setting] ?? ''}
      help={help}
      disabled={disabled}
      onChange={(value) => update(setting, value)}
      onBrowse={
        kind ? () => void pickSetting(setting, kind).catch((error) => setError(error.message)) : undefined
      }
    />
  );
}
