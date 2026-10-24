import { describe, expect, it } from 'vitest';
import { parseEntry } from './parse';
import { entryToLatex } from './tolatex';
import { latexToText } from './fromlatex';

const tex = (raw: string, v?: number) => entryToLatex(parseEntry(raw), v)!;
const deps = (raw: string) => [...((parseEntry(raw) as { deps?: string[] }).deps ?? [])].sort();

// Issue #23: subscripted names showed as "omega\_0" (equations) or italic
// letters o·m·e·g·a₀ (slider rows); \omega_0X was read as the name omega_0X.
describe('subscripted names', () => {
  it('render as symbols with a subscript', () => {
    expect(tex('omega_0 = 1.8')).toBe('\\omega_{0} = 1.8');
    expect(tex('a_1 = 2')).toBe('a_{1} = 2');
    const ode = tex("X'' = -omega_0*X - (b)*X'");
    expect(ode).toContain('\\omega_{0}');
    expect(ode).not.toMatch(/\\_|omega\\?_0|\\left\(\{?b\}?\\right\)/);
    expect(tex("y_1'' = -y_1")).toMatch(/^\s*y_\{1\}'' = - y_\{1\}$/);
    expect(tex("y' = y, y(0) = omega_0")).toMatch(/= +\\omega_\{0\}$/);
    expect(tex('f(u_1) = u_1^2')).toMatch(/^f\\left\(u_\{1\}\\right\)/);
  });

  it('a subscript ends the name in editor input', () => {
    expect(latexToText("X''=-\\omega_0X-bX'")).toBe("X''=-omega_0 X-bX'");
    expect(latexToText("X''=-\\omega_{0}X-bX'")).toBe("X''=-omega_0 X-bX'");
    expect(deps(latexToText("X''=-\\omega_0X-bX'"))).toEqual(['D1_bX', 'omega_0'].sort());
    expect(latexToText('y_1\'=y_1')).toBe("y_1'=y_1");
    // log_b keeps its base for replaceLogBase.
    expect(latexToText('y=\\log_2(x)')).toBe('y=log(x, 2)');
  });

  it('round-trips through the editor unchanged in meaning', () => {
    for (const raw of ['omega_0 = 1.8', "X'' = -omega_0*X - b*X'", "y_1'' = -y_1", 'y = a_1*x + a_2']) {
      const back = latexToText(tex(raw, 1.8));
      expect(deps(back)).toEqual(deps(raw));
    }
  });
});
