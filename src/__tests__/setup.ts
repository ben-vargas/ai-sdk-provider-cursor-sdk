import { vi } from 'vitest';

vi.mock('@cursor/sdk', async (importActual) => {
  const actual = await importActual<typeof import('@cursor/sdk')>();
  const mocked = await import('./fixtures/mock-cursor-sdk.js');
  return { ...actual, Agent: mocked.Agent };
});
