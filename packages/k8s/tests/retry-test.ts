/**
Copyright (c) 2024 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
SPDX-License-Identifier: Apache-2.0
*/

import {
  isTransientErrorForTest as isTransientError,
  withRetryForTest as withRetry,
  timersForTest as timers
} from '../src/k8s/retry-wrappers'

describe('transient error classification', () => {
  it('classifies apiserver ETIMEDOUT as transient error', () => {
    expect(isTransientError({ code: 'ETIMEDOUT' })).toBe(true)
    expect(isTransientError({ cause: { code: 'ETIMEDOUT' } })).toBe(true)
    expect(isTransientError(new Error('connect ETIMEDOUT 34.18.24.1:443'))).toBe(
      true
    )
  })

  it('classifies 429 and 5xx http status codes as transient error', () => {
    for (const statusCode of [429, 500, 502, 503, 504]) {
      expect(isTransientError({ statusCode })).toBe(true)
    }
    expect(isTransientError({ response: { statusCode: 503 } })).toBe(true)
  })

  it('classifies 4xx (except 429) as non-transient error', () => {
    for (const statusCode of [400, 401, 403, 404, 409, 422]) {
      expect(isTransientError({ statusCode })).toBe(false)
    }
    // other socket errnos are not treated as transient for the time being,
    // we can add later as needed
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

describe('withRetry', () => {
  it('retries a transient failure', async () => {
    // mock the 'sleep' via 'timers' to skip real backoff delay
    jest.spyOn(timers, 'sleep').mockResolvedValue()

    // fails twice with a transient error (ETIMEDOUT), then succeeds.
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('connect ETIMEDOUT 10.0.0.1:443'))
      .mockRejectedValueOnce(new Error('connect ETIMEDOUT '))
      .mockResolvedValue('recovered')

    await expect(withRetry('label', fn)).resolves.toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(3)

    // 2 transient failures + 1 success
    const settled = await Promise.allSettled(fn.mock.results.map(r => r.value))
    const failures = settled.filter(s => s.status === 'rejected')
    const successes = settled.filter(s => s.status === 'fulfilled')
    expect(failures).toHaveLength(2)
    expect(successes).toHaveLength(1)

    jest.restoreAllMocks()
  })
})

