import { FolderOpen } from 'lucide-react';

export function PathField({
  label,
  value,
  help,
  disabled,
  onChange,
  onBrowse,
}: {
  label: string;
  value: string;
  help: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onBrowse?: () => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="path-input">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          spellCheck={false}
        />
        {onBrowse && (
          <button
            title={`Browse ${label}`}
            aria-label={`Browse ${label}`}
            disabled={disabled}
            onClick={(event) => {
              event.preventDefault();
              onBrowse();
            }}
          >
            <FolderOpen size={17} />
          </button>
        )}
      </div>
      <small>{help}</small>
    </label>
  );
}
