/**
 * The two voices BroCode offers: one female, one male.
 *
 * These are the real `voice_styles/*.json` names in the pinned checkpoint, not a marketing list —
 * the inference service loads the file the learner picks, so changing the choice changes the
 * speaker. F1 is the tutor's voice and the service's own default (`SUPERTONIC_STYLE`).
 *
 * Nothing here downloads anything. The weights live on the inference server
 * (`services/supertonic-tts/`), which is also the only thing that knows which presets a given
 * checkpoint exposes — `GET /api/voice/status` reports them, and the picker narrows to that list
 * when it has arrived (`availablePresets`).
 */

export const FEMALE_PRESETS = ['F1'] as const;
export const MALE_PRESETS = ['M1'] as const;

export type VoicePreset = (typeof FEMALE_PRESETS)[number] | (typeof MALE_PRESETS)[number];

/** The two choices the UI offers, in the order it offers them: the female tutor first. */
export const VOICE_PRESETS: readonly VoicePreset[] = [...FEMALE_PRESETS, ...MALE_PRESETS];

/** The female tutor voice. Also the service's own default (`SUPERTONIC_STYLE`). */
export const DEFAULT_PRESET: VoicePreset = 'F1';

export type VoiceGender = 'female' | 'male';

export function genderOf(preset: VoicePreset): VoiceGender {
  return (FEMALE_PRESETS as readonly string[]).includes(preset) ? 'female' : 'male';
}

/** What the selector says — a learner chooses a VOICE, not a checkpoint id. */
export function voiceLabel(preset: VoicePreset): string {
  return genderOf(preset) === 'female' ? 'Female' : 'Male';
}

export function isVoicePreset(value: unknown): value is VoicePreset {
  return typeof value === 'string' && (VOICE_PRESETS as readonly string[]).includes(value);
}

/**
 * The presets the backend actually reported, or every known preset when it has not answered yet.
 *
 * A stale device preference (a preset the deployment no longer ships) is dropped rather than sent
 * as a request the service would reject with 400. An empty/unknown report keeps the known list, so
 * a slow status call never empties the selector.
 */
export function availablePresets(reported?: readonly string[] | null): readonly VoicePreset[] {
  const real = (reported ?? []).filter(isVoicePreset);
  return real.length ? (VOICE_PRESETS.filter((preset) => real.includes(preset)) as readonly VoicePreset[]) : VOICE_PRESETS;
}

/** Keep a stored preference only while the backend still offers it. */
export function resolvePreset(preset: VoicePreset, reported?: readonly string[] | null): VoicePreset {
  const list = availablePresets(reported);
  return list.includes(preset) ? preset : (list[0] ?? DEFAULT_PRESET);
}
