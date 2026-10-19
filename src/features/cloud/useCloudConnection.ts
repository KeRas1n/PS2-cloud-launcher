import { useState } from 'react';
import { useLauncher } from '../../app/useLauncher';
import { api } from '../../lib/launcher-api';
export function useCloudConnection() {
  const { act } = useLauncher();
  const [megaEmail, setMegaEmail] = useState('');
  const [megaPassword, setMegaPassword] = useState('');
  const [megaCode, setMegaCode] = useState('');
  const [changeMegaAccount, setChangeMegaAccount] = useState(false);
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
    connectMega,
  };
}
