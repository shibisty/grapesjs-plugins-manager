import { describe, expect, it } from 'vitest';
import { StateStore } from '../src/core/state';

describe('StateStore', () => {
  it('uses the 0.x keys and JSON arrays', () => {
    const s = new StateStore(localStorage, 'gjs-plugin-manager');
    s.setDisabled('a', true);
    s.remember(['x', 'y']);
    expect(JSON.parse(localStorage.getItem('gjs-plugin-manager:disabled')!)).toEqual(['a']);
    expect(JSON.parse(localStorage.getItem('gjs-plugin-manager:known')!)).toEqual(['x', 'y']);
  });

  it('reads state written by 0.x', () => {
    localStorage.setItem('pm:disabled', JSON.stringify(['old']));
    localStorage.setItem('pm:known', JSON.stringify(['old', 'other']));
    const s = new StateStore(localStorage, 'pm');
    expect(s.isDisabled('old')).toBe(true);
    expect(s.getKnown()).toEqual(['old', 'other']);
  });

  it('remember keeps order and does not duplicate', () => {
    const s = new StateStore(localStorage, 'pm');
    s.remember(['b', 'a']);
    s.remember(['a', 'c']);
    expect(s.getKnown()).toEqual(['b', 'a', 'c']);
  });

  it('forget drops from both lists', () => {
    const s = new StateStore(localStorage, 'pm');
    s.remember(['a', 'b']);
    s.setDisabled('a', true);
    s.forget('a');
    expect(s.getKnown()).toEqual(['b']);
    expect(s.isDisabled('a')).toBe(false);
  });

  it('survives broken JSON, wrong types and a missing storage', () => {
    localStorage.setItem('pm:disabled', '{oops');
    localStorage.setItem('pm:known', JSON.stringify({ a: 1 }));
    const s = new StateStore(localStorage, 'pm');
    expect(s.getDisabled().size).toBe(0);
    expect(s.getKnown()).toEqual([]);
    const none = new StateStore(null, 'pm');
    none.setDisabled('a', true);
    expect(none.isDisabled('a')).toBe(false);
  });

  it('a throwing storage does not throw', () => {
    const bad = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    } as unknown as Storage;
    const s = new StateStore(bad, 'pm');
    expect(() => s.setDisabled('a', true)).not.toThrow();
    expect(s.getKnown()).toEqual([]);
  });

  it('isOwnKey matches the prefix and its sub-keys only', () => {
    const s = new StateStore(localStorage, 'gjs-plugin-manager');
    expect(s.isOwnKey('gjs-plugin-manager:disabled')).toBe(true);
    expect(s.isOwnKey('gjs-plugin-manager')).toBe(true);
    expect(s.isOwnKey('gjs-plugin-manager-other')).toBe(false);
    expect(s.isOwnKey('gjsProject')).toBe(false);
  });
});
