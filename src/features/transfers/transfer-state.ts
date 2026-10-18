import type { Transfer } from '../../../shared/types';

export const activeTransfer = (item: Transfer) => ['queued', 'running', 'cancelling'].includes(item.state);
