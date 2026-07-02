/**
Copyright (c) 2024 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
SPDX-License-Identifier: Apache-2.0
*/

import { isTransientErrorForTest as isTransientError } from '../src/k8s/retry-wrappers'

describe('transient error classification', () => {
  it('retries the apiserver ETIMEDOUT (code and message forms)', () => {
    expect(isTransientError({ code: 'ETIMEDOUT' })).toBe(true)
    expect(isTransientError({ cause: { code: 'ETIMEDOUT' } })).toBe(true)
    expect(isTransientError(new Error('connect ETIMEDOUT 34.18.24.1:443'))).toBe(
      true
    )
  })

  it('retries 429 and 5xx http status codes', () => {
    for (const statusCode of [429, 500, 502, 503, 504]) {
      expect(isTransientError({ statusCode })).toBe(true)
    }
    expect(isTransientError({ response: { statusCode: 503 } })).toBe(true)
  })

  it('does NOT retry non-transient errors', () => {
    for (const statusCode of [400, 401, 403, 404, 409, 422]) {
      expect(isTransientError({ statusCode })).toBe(false)
    }
    // Other socket errnos are no longer treated as transient.
    for (const code of [
      'ECONNRESET',
      'ECONNREFUSED',
      'ECONNABORTED',
    ]) {
      expect(isTransientError({ code })).toBe(false)
    }
    expect(isTransientError(null)).toBe(false)
    expect(isTransientError(undefined)).toBe(false)
  })
})

