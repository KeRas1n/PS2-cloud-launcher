// Preserve existing values/comments while adding missing PCSX2 defaults.
export function readIni(ini: string, section: string, key: string): string | undefined {
  let current = '',
    value: string | undefined;
  for (const line of ini.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const header = /^\s*\[([^\]]+)\]/.exec(line);
    if (header) current = header[1].trim().toLowerCase();
    else if (current === section.toLowerCase()) {
      const pair = /^\s*([^;#=][^=]*)\s*=\s*(.*)$/.exec(line);
      if (pair?.[1].trim().toLowerCase() === key.toLowerCase())
        value = pair[2].trim().replace(/^"(.*)"$/, '$1');
    }
  }
  return value;
}
export function writeIni(ini: string, section: string, values: Record<string, string>): string {
  const lines = ini.replace(/^\uFEFF/, '').split(/\r?\n/);
  let start = lines.findIndex((line) => line.trim().toLowerCase() === `[${section.toLowerCase()}]`);
  if (start < 0) {
    lines.push('', `[${section}]`);
    start = lines.length - 1;
  }
  let end = lines.findIndex((line, index) => index > start && /^\s*\[/.test(line));
  if (end < 0) end = lines.length;
  const keys = new Set(Object.keys(values).map((key) => key.toLowerCase()));
  const kept = lines.slice(start + 1, end).filter((line) => {
    const pair = /^\s*([^;#=][^=]*)\s*=/.exec(line);
    return !pair || !keys.has(pair[1].trim().toLowerCase());
  });
  lines.splice(
    start + 1,
    end - start - 1,
    ...kept,
    ...Object.entries(values).map(([key, value]) => `${key} = ${value}`),
  );
  return lines.join('\n');
}
export function mergeIniDefaults(existing: string, defaults: string): string {
  let result = existing,
    section = '';
  for (const line of defaults.split(/\r?\n/)) {
    const header = /^\s*\[([^\]]+)\]/.exec(line);
    if (header) section = header[1];
    else {
      const pair = /^\s*([^;#=][^=]*)\s*=\s*(.*)$/.exec(line);
      if (section && pair && readIni(result, section, pair[1].trim()) === undefined)
        result = writeIni(result, section, { [pair[1].trim()]: pair[2].trim() });
    }
  }
  return result;
}
