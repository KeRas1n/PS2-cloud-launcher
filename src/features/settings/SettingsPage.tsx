import { Check } from 'lucide-react';
import { settingsTabs } from '../../app/navigation';
import { useLauncher } from '../../app/useLauncher';
import { Button } from '../../components/Button';
import { PageHeading } from '../../components/PageHeading';
import { CloudSettings } from './CloudSettings';
import { EmulatorSettings } from './EmulatorSettings';
import { GamesSettings } from './GamesSettings';
export function SettingsPage() {
  const { disabled, settingsChanged, act, savePreferences, settingsTab, setSettingsTab } = useLauncher();

  return (
    <>
      <div className="settings-heading">
        <PageHeading title="Settings" />
        <Button
          disabled={disabled || !settingsChanged}
          onClick={() => void act('Saving preferences', savePreferences, 'Preferences saved')}
        >
          <Check size={17} /> Save changes
        </Button>
      </div>
      <div className="settings-tabs" role="tablist" aria-label="Settings categories">
        {settingsTabs.map((tab, index) => (
          <button
            key={tab}
            role="tab"
            id={`settings-tab-${tab}`}
            aria-selected={settingsTab === tab}
            aria-controls={`settings-panel-${tab}`}
            tabIndex={settingsTab === tab ? 0 : -1}
            onClick={() => setSettingsTab(tab)}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % settingsTabs.length
                  : event.key === 'ArrowLeft'
                    ? (index + settingsTabs.length - 1) % settingsTabs.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? settingsTabs.length - 1
                        : undefined;
              if (next !== undefined) {
                event.preventDefault();
                setSettingsTab(settingsTabs[next]);
                document.getElementById(`settings-tab-${settingsTabs[next]}`)?.focus();
              }
            }}
          >
            {tab}
          </button>
        ))}
      </div>
      {settingsChanged && <div className="unsaved">Unsaved changes.</div>}
      {settingsTab === 'Games' && <GamesSettings />}
      {settingsTab === 'Emulator' && <EmulatorSettings />}
      {settingsTab === 'Cloud' && <CloudSettings />}
    </>
  );
}
