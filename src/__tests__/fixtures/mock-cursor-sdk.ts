import { vi } from 'vitest';

export const mockAgentCreate = vi.fn();
export const mockAgentResume = vi.fn();

export class Agent {
  static create = mockAgentCreate;
  static resume = mockAgentResume;
}

export function resetCursorSdkMock(): void {
  mockAgentCreate.mockReset();
  mockAgentResume.mockReset();
}
