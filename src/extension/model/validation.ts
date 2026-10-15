// Runs the Khronos glTF Validator over a model and turns its report into what the webview shows.
// Free of VS Code APIs: the extension runs the validator in a worker, the tests in place.
import type {
  HostToWebviewMessage,
  Severity,
  ValidationIssue,
  ValidationReport,
} from '../../shared/protocol';
import type { LoadTexts, ResourceOpener } from './load';
import { resourceName } from './resources';
import type { ByteSource } from './sources';

/** The parts of the validator's report this reads. */
export interface ValidatorReport {
  validatorVersion?: string;
  issues?: {
    messages?: {
      code?: string;
      message?: string;
      severity?: number;
      pointer?: string;
      offset?: number;
    }[];
    truncated?: boolean;
  };
}

/**
 * Validates a model's bytes; `resource` reads what a URI in it points to, and rejects with a
 * sentence for the user when it can't.
 */
export type Validator = (
  data: Uint8Array,
  resource: (uri: string) => Promise<Uint8Array>,
) => Promise<ValidatorReport>;

/**
 * The validator holds the whole model in memory, several times over while it works: past this,
 * it isn't run.
 */
export const MAX_VALIDATION_BYTES = 1024 ** 3;

/** Issues past this many aren't reported: a damaged model can have one per vertex. */
export const MAX_ISSUES = 1000;

const SEVERITIES: Severity[] = ['error', 'warning', 'info', 'hint'];

/** Validates the model in `source`, resolving its resources as the viewer does. */
export async function validationMessage(
  source: ByteSource,
  openResource: ResourceOpener,
  validate: Validator,
  loadId: number,
  texts: Pick<LoadTexts, 'resource'>,
): Promise<HostToWebviewMessage> {
  if (source.size > MAX_VALIDATION_BYTES) {
    return { type: 'validation', loadId, state: 'tooLarge', bytes: source.size };
  }
  try {
    const data = await source.read(0, source.size);
    const report = await validate(data, async (uri) => {
      const opened = await openResource(uri);
      // The validator puts the reason in its report, as the viewer says it.
      if (typeof opened === 'string') throw texts.resource(opened, resourceName(uri));
      try {
        return await opened.read(0, opened.size);
      } finally {
        await opened.close();
      }
    });
    return { type: 'validation', loadId, state: 'done', report: validationReport(report) };
  } catch {
    return { type: 'validation', loadId, state: 'failed' };
  }
}

/** The validator's report as the webview shows it: errors first, its messages tidied. */
export function validationReport(raw: ValidatorReport): ValidationReport {
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0, hint: 0 };
  const issues: ValidationIssue[] = [];
  for (const message of raw.issues?.messages ?? []) {
    const severity = SEVERITIES[message.severity ?? -1];
    if (!severity) continue;
    counts[severity]++;
    const issue: ValidationIssue = {
      code: message.code ?? '',
      // A resource the validator couldn't read comes back as the reason it was given, wrapped.
      message: (message.message ?? '').replace(/^Node Exception: (Error: )?/, ''),
      severity,
    };
    if (typeof message.pointer === 'string') issue.pointer = message.pointer;
    if (typeof message.offset === 'number') issue.offset = message.offset;
    issues.push(issue);
  }
  issues.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
  return {
    validator: raw.validatorVersion ?? '',
    counts,
    issues,
    truncated: raw.issues?.truncated === true,
  };
}
