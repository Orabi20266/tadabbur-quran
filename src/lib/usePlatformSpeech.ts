import { Capacitor } from '@capacitor/core';
import { useNativeSpeech } from './useNativeSpeech';
import { useSpeech } from './useSpeech';
import type { Speech, SpeechOptions } from './useSpeech';

/**
 * One entry point for both pages. Both hooks are called unconditionally so
 * React's hook order never changes; the platform flag only decides which
 * engine is returned. The web path is byte-for-byte the original behaviour.
 */
export function usePlatformSpeech(
  onTokens: (tokens: string[]) => void,
  lang = 'ar-SA',
  options?: SpeechOptions,
): Speech {
  const web = useSpeech(onTokens, lang, options);
  const native = useNativeSpeech(onTokens, lang);
  return Capacitor.isNativePlatform() ? native : web;
}
