import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deploymentOrigin } from '../deployment-origin.mjs';

test('website origin follows the configured HTTPS domain, independent of mailbox domain', () => {
  assert.equal(deploymentOrigin('https://web.example.org'), 'https://web.example.org');
  assert.equal(deploymentOrigin('https://web.example.org:9443'), 'https://web.example.org:9443');
});
test('unsafe, missing and non-canonical deployment origins are rejected', () => {
  for (const value of [undefined, '', 'http://web.example.org', 'https://user:password@web.example.org',
    'https://web.example.org/', 'https://web.example.org/login', 'https://web.example.org?q=1',
    'https://web.example.org#anchor', 'https://WEB.example.org', 'https://web.example.org:443']) {
    assert.throws(() => deploymentOrigin(value));
  }
});
