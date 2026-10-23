import { describe, expect, it } from 'vitest';
import {
  evalColor,
  hslToRgb,
  hsvToRgb,
  isColorExpr,
  parseColorLiteral,
  toCss,
  toHex,
} from './color';

describe('colour literals', () => {
  it('parses 3/4/6/8-digit hex', () => {
    expect(parseColorLiteral('#f00')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColorLiteral('#c74440')).toEqual({ r: 199, g: 68, b: 64, a: 1 });
    expect(parseColorLiteral('#00000080')!.a).toBeCloseTo(128 / 255);
    expect(parseColorLiteral('#0f08')!.a).toBeCloseTo(136 / 255);
  });
  it('parses names case-insensitively', () => {
    expect(parseColorLiteral('White')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColorLiteral('transparent')!.a).toBe(0);
  });
  it('rejects junk', () => {
    expect(parseColorLiteral('#12')).toBeNull();
    expect(parseColorLiteral('#12345')).toBeNull();
    expect(parseColorLiteral('nope')).toBeNull();
  });
});

describe('colour spaces', () => {
  it('hsv primaries and hue wrap-around', () => {
    expect(hsvToRgb(0, 1, 1)).toEqual([255, 0, 0]);
    expect(hsvToRgb(120, 1, 1).map(Math.round)).toEqual([0, 255, 0]);
    expect(hsvToRgb(240, 1, 1).map(Math.round)).toEqual([0, 0, 255]);
    expect(hsvToRgb(360 + 240, 1, 1).map(Math.round)).toEqual([0, 0, 255]);
    expect(hsvToRgb(-120, 1, 1).map(Math.round)).toEqual([0, 0, 255]);
    expect(hsvToRgb(77, 0, 0.5).map(Math.round)).toEqual([128, 128, 128]);
  });
  it('hsl primaries', () => {
    expect(hslToRgb(0, 1, 0.5).map(Math.round)).toEqual([255, 0, 0]);
    expect(hslToRgb(0, 0, 1).map(Math.round)).toEqual([255, 255, 255]);
    expect(hslToRgb(0, 1, 0).map(Math.round)).toEqual([0, 0, 0]);
  });
});

describe('colour expressions', () => {
  it('evaluates rgb / rgba / hsv / gray against the scope', () => {
    expect(evalColor('rgb(255*a, 0, 0)', { a: 0.5 })).toEqual({ r: 127.5, g: 0, b: 0, a: 1 });
    expect(evalColor('rgba(0,0,0, a)', { a: 0.25 })!.a).toBe(0.25);
    expect(evalColor('hsv(120, 1, 1)')!.g).toBeCloseTo(255);
    expect(evalColor('hsla(0, 1, 0.5, 0.5)')!.a).toBe(0.5);
    expect(evalColor('gray(0.5)')!.r).toBeCloseTo(127.5);
  });
  it('clamps out-of-range channels', () => {
    expect(evalColor('rgba(999, -5, 10, 3)')).toEqual({ r: 255, g: 0, b: 10, a: 1 });
  });
  it('supports hex inside expressions, mixing and re-alpha', () => {
    const c = evalColor('mixc(#000000, #ffffff, u)', { u: 0.5 })!;
    expect(c.r).toBeCloseTo(127.5);
    expect(evalColor('alpha(#ff0000, 0.3)')).toEqual({ r: 255, g: 0, b: 0, a: 0.3 });
  });
  it('can use functions from the scope (scripting helpers)', () => {
    const scope = { T: 1, keys: (T: number, ...p: number[]) => (T >= p[2] ? p[3] : p[1]) };
    expect(evalColor('rgba(0,0,0, keys(T, 0, 0, 1, 1))', scope)!.a).toBe(1);
  });
  it('returns null for non-colours and bad syntax', () => {
    expect(evalColor('')).toBeNull();
    expect(evalColor(undefined)).toBeNull();
    expect(evalColor('3 + 4')).toBeNull();
    expect(evalColor('rgb(')).toBeNull();
    expect(isColorExpr('rgb(')).toBe(false);
    expect(isColorExpr('hsv(T, 1, 1)')).toBe(true);
    expect(isColorExpr('#abc')).toBe(true);
  });
  it('formats CSS and hex', () => {
    expect(toCss({ r: 255, g: 0, b: 0, a: 1 })).toBe('rgba(255, 0, 0, 1)');
    expect(toCss({ r: 255, g: 0, b: 0, a: 0.5 }, 0.5)).toBe('rgba(255, 0, 0, 0.25)');
    expect(toHex({ r: 199, g: 68, b: 64, a: 1 })).toBe('#c74440');
  });
});
