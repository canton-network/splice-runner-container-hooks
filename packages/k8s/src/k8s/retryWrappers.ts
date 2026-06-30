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

// check if the error is a transient failure
function isTransientError(err: unknown): boolean {
  const e = (err ?? {}) as Record<string, unknown>
  const code = e.code ?? e.errno ?? (e.cause as Record<string, unknown>)?.code
  const status =
    e.statusCode ?? (e.response as Record<string, unknown>)?.statusCode
  const msg = typeof e.message === 'string' ? e.message : String(err ?? '')
  return (
    /\bETIMEDOUT\b/.test(`${code ?? ''} ${msg}`) ||
    (typeof status === 'number' && [429, 500, 502, 503, 504].includes(status))
  )
}

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

// exponential backoff + full jitter, bounded to max_delay.
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
      const baseMs = 1000 * 2 ** (attempt - 1)
      const delayMs = Math.min(maxDelayMs, Math.floor(baseMs + Math.random() * 1000))
      core.warning(
        `[k8s ${label}] transient error (attempt ${attempt}/${attempts}), retrying in ${delayMs}ms: ${
          (err as { message?: string })?.message ?? err
        }`
      )
      await sleep(delayMs)
    }
  }
}

// Retried API calls, only the ones the hooks import

export const createPod = (
  jobContainer?: k8s.V1Container,
  services?: k8s.V1Container[],
  registry?: Registry,
  extension?: k8s.V1PodTemplateSpec
): Promise<k8s.V1Pod> =>
  withRetry('createPod', () =>
    raw.createPod(jobContainer, services, registry, extension)
  )

export const createService = (pod: k8s.V1Pod): Promise<k8s.V1Service> =>
  withRetry('createService', () => raw.createService(pod))

export const createJob = (
  container: k8s.V1Container,
  extension?: k8s.V1PodTemplateSpec
): Promise<k8s.V1Job> =>
  withRetry('createJob', () => raw.createJob(container, extension))

export const getContainerJobPodName = (jobName: string): Promise<string> =>
  withRetry('getContainerJobPodName', () => raw.getContainerJobPodName(jobName))

export const createSecretForEnvs = (envs: {
  [key: string]: string
}): Promise<string> =>
  withRetry('createSecretForEnvs', () => raw.createSecretForEnvs(envs))

export const getPodStatus = (
  name: string
): Promise<k8s.V1PodStatus | undefined> =>
  withRetry('getPodStatus', () => raw.getPodStatus(name))

export const isAuthPermissionsOK = (): Promise<boolean> =>
  withRetry('isAuthPermissionsOK', () => raw.isAuthPermissionsOK())

export const isPodContainerAlpine = (
  podName: string,
  containerName: string
): Promise<boolean> =>
  withRetry('isPodContainerAlpine', () =>
    raw.isPodContainerAlpine(podName, containerName)
  )

export const prunePods = (): Promise<void> =>
  withRetry('prunePods', () => raw.prunePods())

export const pruneServices = (): Promise<void> =>
  withRetry('pruneServices', () => raw.pruneServices())

export const pruneSecrets = (): Promise<void> =>
  withRetry('pruneSecrets', () => raw.pruneSecrets())

export const prunePodsAndServices = async (): Promise<void> => {
  await Promise.all([prunePods(), pruneServices()])
}

export const waitForPodPhases = (
  podName: string,
  awaitingPhases: Set<PodPhase>,
  backOffPhases: Set<PodPhase>,
  maxTimeSeconds?: number
): Promise<void> =>
  withRetry('waitForPodPhases', () =>
    raw.waitForPodPhases(podName, awaitingPhases, backOffPhases, maxTimeSeconds)
  )

export const waitForJobToComplete = (jobName: string): Promise<void> =>
  withRetry('waitForJobToComplete', () => raw.waitForJobToComplete(jobName))

// Not retried, re-exported unchanged

export const getPodLogs = (
  podName: string,
  containerName: string
): Promise<void> => raw.getPodLogs(podName, containerName)

export const containerPorts = (
  container: ContainerInfo
): k8s.V1ContainerPort[] => raw.containerPorts(container)

export const getPrepareJobTimeoutSeconds = (): number =>
  raw.getPrepareJobTimeoutSeconds()
