/** Provider-neutral AI contracts. */
export interface ProviderContext {
  readonly correlationId: string;
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly schemaVersion: string;
}

export interface AudioInput {
  readonly objectKey: string;
  readonly mimeType: string;
  readonly language?: string;
  /** Local deterministic fixture only; real providers ignore this field. */
  readonly fixtureKey?: string;
}

export interface TranscriptResult {
  readonly text: string;
  readonly confidence?: number;
  readonly durationMs?: number;
}

export interface StructuredGenerationInput {
  readonly instructionKey: string;
  readonly input: unknown;
}

export interface StructuredGenerationResult<TOutput> {
  readonly output: TOutput;
  readonly confidence?: number;
  readonly evidence: readonly string[];
}

export interface SpeechInput {
  readonly text: string;
  readonly language?: string;
  readonly voiceKey?: string;
}

export interface SpeechResult {
  readonly objectKey: string;
  readonly mimeType: string;
  readonly durationMs?: number;
}

export interface TranscriptionProvider {
  transcribe(input: AudioInput, context: ProviderContext): Promise<TranscriptResult>;
}

export interface StructuredAnalysisProvider {
  generate<TOutput>(
    input: StructuredGenerationInput,
    context: ProviderContext,
  ): Promise<StructuredGenerationResult<TOutput>>;
}

export interface SpeechProvider {
  synthesize(input: SpeechInput, context: ProviderContext): Promise<SpeechResult>;
}

export * from './fake.js';
