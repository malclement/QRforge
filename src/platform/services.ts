/** Browser singletons: storage and the verification session. */
import { VerificationSession } from '../state/verification.ts';
import { ProjectRepository } from './storage/repository.ts';
import { createBrowserBackend } from './verify-backend.ts';

export const repository = new ProjectRepository();

export const session = new VerificationSession({
  foreground: createBrowserBackend(),
  background: createBrowserBackend(),
  store: repository,
});
