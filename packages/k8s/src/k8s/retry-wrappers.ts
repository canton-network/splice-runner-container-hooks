/**
Copyright (c) 2024 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Retry wrapper over the raw Kubernetes helpers in ./index.ts
 *
 * Survive transient kube-apiserver connectivity blips
 * (e.g. connect ETIMEDOUT <apiserver>:443) #DACH-NY/cn-test-failures/issues/8613
 * The hook entrypoints import their k8s helpers from this module
 * instead of from './index', so the wrapped calls are retried.
 * Only transient errors(5xx, 429 etc) are retried
 */

import * as core from '@actions/core'
import * as k8s from '@kubernetes/client-node'
import { ContainerInfo, Registry } from 'hooklib'

import * as raw from './index'
import { PodPhase } from './utils'

// error codes/messages considered transient
const TRANSIENT_ERROR_PATTERN = /\bETIMEDOUT\b/
// HTTP status codes considered transient
const TRANSIENT_HTTP_STATUS_CODES = [429, 500, 502, 503, 504]

// check if the error is a transient failure
function isTransientError(err: unknown): boolean {
  const e = (err ?? {}) as Record<string, unknown>
  const code = e.code ?? e.errno ?? (e.cause as Record<string, unknown>)?.code
  const status =
    e.statusCode ?? (e.response as Record<string, unknown>)?.statusCode
  const msg = typeof e.message === 'string' ? e.message : String(err ?? '')
  return (
    TRANSIENT_ERROR_PATTERN.test(`${code ?? ''} ${msg}`) ||
    (typeof status === 'number' && TRANSIENT_HTTP_STATUS_CODES.includes(status))
  )
}

// wrapped in an object so tests can mock the backoff delay
const timers = {
  sleep: async (ms: number): Promise<void> =>
    new Promise(resolve => setTimeout(resolve, ms))
}

// exponential backoff + full jitter, bounded to a max_delay.
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const attempts = 5
  const maxDelayMs = 8000
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (!isTransientError(err) || attempt >= attempts) {
        throw err
      }
      const baseMs = Math.min(maxDelayMs, 1000 * 2 ** (attempt - 1))
      const delayMs = Math.floor(baseMs * Math.random())
      core.warning(
        `[${label}] transient error (attempt ${attempt}/${attempts}), retrying in ${delayMs}ms: ${
          (err as { message?: string })?.message ?? err
        }`
      )
      await timers.sleep(delayMs)
    }
  }
}

// Retried API calls, only the ones the hooks import

export const createPod = async (
  jobContainer?: k8s.V1Container,
  services?: k8s.V1Container[],
  registry?: Registry,
  extension?: k8s.V1PodTemplateSpec
): Promise<k8s.V1Pod> =>
  withRetry('createPod', async () =>
    raw.createPod(jobContainer, services, registry, extension)
  )

export const createService = async (pod: k8s.V1Pod): Promise<k8s.V1Service> =>
  withRetry('createService', async () => raw.createService(pod))

export const createJob = async (
  container: k8s.V1Container,
  extension?: k8s.V1PodTemplateSpec
): Promise<k8s.V1Job> =>
  withRetry('createJob', async () => raw.createJob(container, extension))

export const getContainerJobPodName = async (
  jobName: string
): Promise<string> =>
  withRetry('getContainerJobPodName', async () =>
    raw.getContainerJobPodName(jobName)
  )

export const createSecretForEnvs = async (envs: {
  [key: string]: string
}): Promise<string> =>
  withRetry('createSecretForEnvs', async () => raw.createSecretForEnvs(envs))

export const getPodStatus = async (
  name: string
): Promise<k8s.V1PodStatus | undefined> =>
  withRetry('getPodStatus', async () => raw.getPodStatus(name))

export const isAuthPermissionsOK = async (): Promise<boolean> =>
  withRetry('isAuthPermissionsOK', async () => raw.isAuthPermissionsOK())

export const isPodContainerAlpine = async (
  podName: string,
  containerName: string
): Promise<boolean> =>
  withRetry('isPodContainerAlpine', async () =>
    raw.isPodContainerAlpine(podName, containerName)
  )

export const prunePods = async (): Promise<void> =>
  withRetry('prunePods', async () => raw.prunePods())

export const pruneServices = async (): Promise<void> =>
  withRetry('pruneServices', async () => raw.pruneServices())

export const pruneSecrets = async (): Promise<void> =>
  withRetry('pruneSecrets', async () => raw.pruneSecrets())

export const prunePodsAndServices = async (): Promise<void> => {
  await Promise.all([prunePods(), pruneServices()])
}

export const waitForPodPhases = async (
  podName: string,
  awaitingPhases: Set<PodPhase>,
  backOffPhases: Set<PodPhase>,
  maxTimeSeconds?: number
): Promise<void> =>
  withRetry('waitForPodPhases', async () =>
    raw.waitForPodPhases(podName, awaitingPhases, backOffPhases, maxTimeSeconds)
  )

export const waitForJobToComplete = async (jobName: string): Promise<void> =>
  withRetry('waitForJobToComplete', async () =>
    raw.waitForJobToComplete(jobName)
  )

// Not retried, re-exported unchanged

export const getPodLogs = async (
  podName: string,
  containerName: string
): Promise<void> => raw.getPodLogs(podName, containerName)

export const containerPorts = (
  container: ContainerInfo
): k8s.V1ContainerPort[] => raw.containerPorts(container)

export const getPrepareJobTimeoutSeconds = (): number =>
  raw.getPrepareJobTimeoutSeconds()

// Exposed for unit testing
export const isTransientErrorForTest = isTransientError
export const withRetryForTest = withRetry
export const timersForTest = timers
