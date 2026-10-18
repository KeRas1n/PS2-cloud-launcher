import { useState } from 'react';
import type { CloudProvider } from '../../../shared/types';
import { useLauncher } from '../../app/useLauncher';
import { api } from '../../lib/launcher-api';
export function useCloudConnection() {
  const { act, setLibrary } = useLauncher();
  const [megaEmail, setMegaEmail] = useState('');
  const [megaPassword, setMegaPassword] = useState('');
  const [megaCode, setMegaCode] = useState('');
  const [changeMegaAccount, setChangeMegaAccount] = useState(false);
  async function selectProvider(provider: CloudProvider) {
    setMegaEmail('');
    setMegaPassword('');
    setMegaCode('');
    setChangeMegaAccount(false);
    setLibrary({ games: [], warnings: [], cloudChecked: false });
    await act('Switching cloud storage', () => api!.selectCloudProvider(provider), 'Cloud storage changed');
  }
  async function connectMega() {
    const credentials = {
      email: megaEmail.trim(),
      password: megaPassword,
      ...(megaCode ? { code: megaCode } : {}),
    };
    setMegaPassword('');
    setMegaCode('');
    await act(
      'Connecting MEGA',
      async () => {
        await api!.connectCloud(credentials);
        setChangeMegaAccount(false);
      },
      'MEGA connected',
    );
  }
  return {
    megaEmail,
    setMegaEmail,
    megaPassword,
    setMegaPassword,
    megaCode,
    setMegaCode,
    changeMegaAccount,
    setChangeMegaAccount,
    selectProvider,
    connectMega,
  };
}
