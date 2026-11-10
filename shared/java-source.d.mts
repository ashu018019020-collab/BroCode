export type JavaSourceMode = 'program' | 'renamed' | 'wrapped' | 'empty';

export interface PreparedJavaSource {
  source: string;
  mode: JavaSourceMode;
  changed: boolean;
}

export function renameJavaIdentifier(source: string, from: string, to: string): string;
export function prepareJavaSource(source: string): PreparedJavaSource;
