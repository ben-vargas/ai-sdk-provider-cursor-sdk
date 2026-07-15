import { mapCursorFinishReason } from './map-finish-reason.js';

describe('mapCursorFinishReason', () => {
  it('maps finished to stop', () => {
    expect(mapCursorFinishReason({ id: 'run', status: 'finished' })).toEqual({
      unified: 'stop',
      raw: 'finished',
    });
  });

  it('maps error to its raw Cursor error code', () => {
    expect(
      mapCursorFinishReason({
        id: 'run',
        status: 'error',
        error: { message: 'failed', code: 'policy_denied' },
      })
    ).toEqual({ unified: 'error', raw: 'policy_denied' });
    expect(
      mapCursorFinishReason({ id: 'run', status: 'error', error: { message: 'failed' } })
    ).toEqual({ unified: 'error', raw: 'error' });
  });

  it('maps external cancellation conservatively to other', () => {
    expect(mapCursorFinishReason({ id: 'run', status: 'cancelled' })).toEqual({
      unified: 'other',
      raw: 'cancelled',
    });
  });
});
