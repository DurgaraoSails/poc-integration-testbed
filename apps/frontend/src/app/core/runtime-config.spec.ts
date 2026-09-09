import { describe, expect, it } from 'vitest';

import { readPortalOrigin } from './runtime-config';

/**
 * What the deployment is allowed to inject as PORTAL_ORIGIN.
 *
 * The normalising cases are the ones that matter in practice. `event.origin` is always the bare
 * form, so a configured value that is *written* differently but *means* the same origin has to be
 * folded onto the same string — otherwise the POC boots looking correctly configured and then
 * silently rejects every message the portal sends it.
 */
describe('readPortalOrigin', () => {
  it('accepts a bare origin', () => {
    expect(readPortalOrigin('https://portal.example.com')).toBe('https://portal.example.com');
  });

  it('accepts an explicit port', () => {
    expect(readPortalOrigin('https://portal.example.com:8443')).toBe('https://portal.example.com:8443');
  });

  it('normalises a trailing slash', () => {
    expect(readPortalOrigin('https://portal.example.com/')).toBe('https://portal.example.com');
  });

  it('normalises an explicit default port away', () => {
    expect(readPortalOrigin('https://portal.example.com:443')).toBe('https://portal.example.com');
  });

  it('normalises scheme and host case', () => {
    expect(readPortalOrigin('HTTPS://Portal.Example.COM')).toBe('https://portal.example.com');
  });

  it('rejects a wildcard', () => {
    expect(readPortalOrigin('*')).toBeNull();
  });

  it('rejects an empty value', () => {
    expect(readPortalOrigin('')).toBeNull();
  });

  it('rejects a URL with a path — an origin was expected, and guessing is not safe', () => {
    expect(readPortalOrigin('https://portal.example.com/workspace')).toBeNull();
  });

  it('rejects a query or fragment', () => {
    expect(readPortalOrigin('https://portal.example.com?tenant=a')).toBeNull();
    expect(readPortalOrigin('https://portal.example.com#x')).toBeNull();
  });

  it('rejects something that is not a URL at all', () => {
    expect(readPortalOrigin('portal.example.com')).toBeNull();
    expect(readPortalOrigin('not a url')).toBeNull();
  });
});
