import { describe, expect, it } from 'vitest';

import { faultKey, faultToProblem, toProblems } from '../src/problems';

// Fixtures are verbatim check_app_source results from the server's compiler.

describe('toProblems', () => {
  it('returns nothing for a valid app', () => {
    expect(toProblems({ valid: true })).toEqual([]);
  });

  it('undoes the wrapper offset for a line-1 compile error', () => {
    // Source `bot.turn(;` — the `;` is char 10, reported as 31 because the
    // server compiles it after "(() => {'use strict';".
    expect(
      toProblems({
        valid: false,
        stage: 'compile',
        errorCode: 'E017',
        message: "Unexpected token ';' (line 1, char 31)",
        timedOut: false,
      })
    ).toEqual([{ line: 0, column: 9, message: "E017: Unexpected token ';'" }]);
  });

  it('keeps columns on later lines', () => {
    expect(
      toProblems({
        valid: false,
        stage: 'compile',
        errorCode: 'E017',
        message: "Unexpected token ';' (line 3, char 10)",
      })
    ).toEqual([{ line: 2, column: 9, message: "E017: Unexpected token ';'" }]);
  });

  it('splits lint findings, each at its own location', () => {
    expect(
      toProblems({
        valid: false,
        stage: 'lint',
        errorCode: 'E027',
        message:
          "'foo' is not defined (line 1, char 1); 'bar' is not defined " +
          "(line 3, char 3); 'baz' is not defined (line 3, char 7).",
      })
    ).toEqual([
      { line: 0, column: 0, message: "E027: 'foo' is not defined" },
      { line: 2, column: 2, message: "E027: 'bar' is not defined" },
      { line: 2, column: 6, message: "E027: 'baz' is not defined" },
    ]);
  });

  it('pins a lint overflow note to the first line', () => {
    const problems = toProblems({
      valid: false,
      stage: 'lint',
      errorCode: 'E027',
      message: "'a' is not defined (line 2, char 1); and 3 more.",
    });
    expect(problems[1]).toEqual({
      line: 0,
      column: 0,
      message: 'E027: and 3 more',
    });
  });

  it('pins a location-less load error to the first line', () => {
    expect(
      toProblems({
        valid: false,
        stage: 'load',
        errorCode: 'E017',
        message: "Cannot read properties of null (reading 'x')",
      })
    ).toEqual([
      {
        line: 0,
        column: 0,
        message: "E017: Cannot read properties of null (reading 'x')",
      },
    ]);
  });
});

describe('faultToProblem', () => {
  const fault = {
    appId: 'a',
    botId: 'b',
    botIndex: 3,
    code: 'E017',
    kind: 'handler',
    message: "Cannot read properties of null (reading 'x') (line 4, char 9)",
    line: 4,
    column: 9,
    timedOut: false,
    time: 812,
  };

  it('points at the failing line and names the bot and tick', () => {
    expect(faultToProblem(fault)).toEqual({
      line: 3,
      column: 8,
      message:
        "E017: Cannot read properties of null (reading 'x') (bot #3 crashed at tick 812)",
    });
  });

  it('undoes the wrapper offset on line 1', () => {
    expect(faultToProblem({ ...fault, line: 1, column: 25 }).column).toBe(3);
  });

  it('falls back to the first line when there is no location', () => {
    const p = faultToProblem({ ...fault, line: undefined, column: undefined });
    expect([p.line, p.column]).toEqual([0, 0]);
  });

  it('keys the same crash identically', () => {
    expect(faultKey(fault)).toBe(faultKey({ ...fault }));
    expect(faultKey(fault)).not.toBe(faultKey({ ...fault, time: 813 }));
  });
});
