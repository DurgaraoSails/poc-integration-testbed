import { describe, expect, it } from 'vitest';

import { isPocApiUrl } from './poc-api';

/**
 * The allowlist that decides where this POC's token may go. The cases that matter are the ones a
 * string prefix check would get wrong: a sibling path that merely starts with the same characters,
 * and an absolute URL on another host that still contains `/api/`.
 *
 * `apiBasePath` resolves to '/api' here because jsdom supplies no injected runtime config, which
 * is the same shape as a deployment at the domain root.
 */
describe('isPocApiUrl', () => {
  it('accepts this POC\'s own API paths', () => {
    expect(isPocApiUrl('api/session/whoami')).toBe(true);
    expect(isPocApiUrl('/api/files')).toBe(true);
    expect(isPocApiUrl('/api/files/42/content')).toBe(true);
  });

  it('accepts the API root itself, with or without a trailing slash', () => {
    expect(isPocApiUrl('/api')).toBe(true);
    expect(isPocApiUrl('/api/')).toBe(true);
  });

  it('rejects a sibling path that only shares the prefix', () => {
    // The case `url.startsWith('/api')` gets wrong.
    expect(isPocApiUrl('/api-docs')).toBe(false);
    expect(isPocApiUrl('/apiary/keys')).toBe(false);
  });

  it('rejects public assets and runtime config', () => {
    expect(isPocApiUrl('/healthz')).toBe(false);
    expect(isPocApiUrl('/index.html')).toBe(false);
    expect(isPocApiUrl('/')).toBe(false);
  });

  it('rejects another origin even when its path looks like ours', () => {
    // The case a substring check gets wrong, and the one that actually leaks a credential.
    expect(isPocApiUrl('https://evil.example.com/api/files')).toBe(false);
    expect(isPocApiUrl('//evil.example.com/api/files')).toBe(false);
    expect(isPocApiUrl('https://platform-api.example.com/poc-files')).toBe(false);
  });

  it('rejects a malformed URL rather than defaulting to attaching a token', () => {
    expect(isPocApiUrl('http://')).toBe(false);
  });
});
