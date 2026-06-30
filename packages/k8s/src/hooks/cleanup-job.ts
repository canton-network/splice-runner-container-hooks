import { prunePods, pruneServices, pruneSecrets } from '../k8s/retryWrappers'

export async function cleanupJob(): Promise<void> {
  await Promise.all([prunePods(), pruneServices(), pruneSecrets()])
}
