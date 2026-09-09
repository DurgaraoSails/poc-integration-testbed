import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import { describeFileError } from './files-panel';

/**
 * The platform distinguishes quota, size, type and ownership failures by status code. Guide
 * §8/§13 asks for each to be understandable rather than collapsed into "HTTP 409" — so what is
 * being asserted here is that the four a user can actually do something about say different,
 * actionable things.
 */
describe('describeFileError', () => {
  const message = (status: number) =>
    describeFileError(new HttpErrorResponse({ status }), 'upload report.pdf');

  it('names the action that failed', () => {
    expect(message(500)).toContain('upload report.pdf');
  });

  it('explains a quota failure as a quota failure', () => {
    expect(message(409)).toMatch(/quota/i);
    expect(message(409)).toMatch(/delete something/i);
  });

  it('explains a size failure as a size failure', () => {
    expect(message(413)).toMatch(/larger than/i);
  });

  it('explains a rejected type as a rejected file', () => {
    expect(message(400)).toMatch(/invalid or an unsupported type/i);
  });

  it('tells the user to reopen from the portal when the session was not accepted', () => {
    expect(message(401)).toMatch(/reopen the poc from the portal/i);
  });

  it('does not reveal whether a non-owned file exists', () => {
    // 404 covers both "gone" and "someone else's" — the wording must not distinguish them.
    expect(message(404)).toMatch(/no longer exists, or it is not yours/i);
  });

  it('separates trial or access denial from an authentication failure', () => {
    expect(message(403)).toMatch(/denied or has expired/i);
    expect(message(403)).not.toMatch(/reopen the poc/i);
  });

  it('reports an unreachable sidecar rather than a bare HTTP 0', () => {
    expect(message(0)).toMatch(/backend sidecar is unreachable/i);
  });

  it('falls back to the status code for anything unanticipated', () => {
    expect(message(418)).toContain('HTTP 418');
  });

  it('gives every handled status a distinct message', () => {
    const handled = [400, 401, 403, 404, 409, 413, 0].map(message);
    expect(new Set(handled).size).toBe(handled.length);
  });
});
