import { validateBytes } from 'gltf-validator';
import { MAX_ISSUES, type Validator } from './validation';

/** The Khronos glTF Validator, run in the calling thread. */
export const runValidator: Validator = (data, resource) =>
  validateBytes(data, {
    maxIssues: MAX_ISSUES,
    writeTimestamp: false,
    externalResourceFunction: resource,
  });
