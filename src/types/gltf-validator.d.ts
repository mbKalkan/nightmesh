// The parts of the Khronos glTF Validator's API that Nightmesh and its tests use.
declare module 'gltf-validator' {
  export interface ValidationReport {
    validatorVersion?: string;
    issues: {
      numErrors: number;
      numWarnings: number;
      numInfos: number;
      numHints: number;
      messages: {
        code: string;
        message: string;
        severity: number;
        pointer?: string;
        offset?: number;
      }[];
      truncated: boolean;
    };
    info?: { extensionsRequired?: string[]; extensionsUsed?: string[] };
  }

  export function version(): string;

  export function validateBytes(
    data: Uint8Array,
    options?: {
      uri?: string;
      externalResourceFunction?: (uri: string) => Promise<Uint8Array>;
      maxIssues?: number;
      writeTimestamp?: boolean;
    },
  ): Promise<ValidationReport>;
}
