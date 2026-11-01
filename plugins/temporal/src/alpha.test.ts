import temporalPlugin from './alpha';

describe('temporal (new frontend system)', () => {
  it('should export a frontend plugin', () => {
    expect(temporalPlugin).toBeDefined();
    expect(temporalPlugin.id).toBe('temporal');
  });
});
