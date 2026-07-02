/**
Copyright (c) 2024 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
SPDX-License-Identifier: Apache-2.0
*/

import { isTransientErrorForTest as isTransient } from '../src/k8s/retry-wrappers'

describe('k8s apiserver retry classification', () => {
  it('retries the apiserver ETIMEDOUT (code and message forms)', () => {
    expect(isTransient({ code: 'ETIMEDOUT' })).toBe(true)
    expect(isTransient({ cause: { code: 'ETIMEDOUT' } })).toBe(true)
    expect(isTransient(new Error('connect ETIMEDOUT 34.18.24.1:443'))).toBe(
      true
    )
  })

  it('retries 429 and 5xx', () => {
    for (const statusCode of [429, 500, 502, 503, 504]) {
      expect(isTransient({ statusCode })).toBe(true)
    }
    expect(isTransient({ response: { statusCode: 503 } })).toBe(true)
  })

  it('does NOT retry non-transient errors', () => {
    for (const statusCode of [400, 401, 403, 404, 409, 422]) {
      expect(isTransient({ statusCode })).toBe(false)
    }
    // Other socket errnos are no longer treated as transient.
    for (const code of [
      'ECONNRESET',
      'ECONNREFUSED',
      'ECONNABORTED',
    ]) {
      expect(isTransient({ code })).toBe(false)
    }
    expect(isTransient(null)).toBe(false)
    expect(isTransient(undefined)).toBe(false)
  })
})

