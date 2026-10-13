// The parts of the Khronos glTF Validator's API the tests use.
declare module 'gltf-validator' {
  export interface ValidationReport {
    issues: {
      numErrors: number;
      numWarnings: number;
      messages: { code: string; message: string; severity: number; pointer?: string }[];
    };
    info?: { extensionsRequired?: string[]; extensionsUsed?: string[] };
  }

  export function validateBytes(
    data: Uint8Array,
    options?: {
      uri?: string;
      externalResourceFunction?: (uri: string) => Promise<Uint8Array>;
      maxIssues?: number;
    },
  ): Promise<ValidationReport>;
}
