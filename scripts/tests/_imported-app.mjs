/**
 * Files merged from `origin/master`'s separate Next.js interview/voice app.
 *
 * They live in this repository for history, but they are not part of the Vite course
 * platform and are excluded from its TypeScript program. Source-scanning UX guards must
 * therefore skip them: a Clerk metadata image width, for example, is not a layout width.
 */
export const IMPORTED_APP_PREFIXES = [
  'src/actions/',
  'src/app/(client)/',
  'src/app/(user)/',
  'src/app/api/',
  'src/components/call/',
  'src/components/dashboard/',
  'src/components/loaders/',
  'src/components/navbar.tsx',
  'src/components/providers.tsx',
  'src/components/sideMenu.tsx',
  'src/components/shared/VoiceChip.tsx',
  'src/components/shared/VoiceIndicator.tsx',
  'src/components/ui/alert-dialog.tsx',
  'src/components/ui/avatar.tsx',
  'src/components/ui/button.tsx',
  'src/components/ui/card.tsx',
  'src/components/ui/carousel.tsx',
  'src/components/ui/context-menu.tsx',
  'src/components/ui/form.tsx',
  'src/components/ui/label.tsx',
  'src/components/ui/scroll-area.tsx',
  'src/components/ui/select.tsx',
  'src/components/ui/separator.tsx',
  'src/components/ui/skeleton.tsx',
  'src/components/ui/slider.tsx',
  'src/components/ui/switch.tsx',
  'src/components/ui/table.tsx',
  'src/components/ui/tabs.tsx',
  'src/components/ui/textarea.tsx',
  'src/components/ui/toast.tsx',
  'src/components/ui/toaster.tsx',
  'src/components/ui/toggle.tsx',
  'src/components/ui/tooltip.tsx',
  'src/components/ui/use-toast.ts',
  'src/contexts/',
  'src/core/ai/voiceService.ts',
  'src/lib/',
  'src/proxy.ts',
  'src/services/',
  'src/types/database.types.ts',
  'src/types/interview.ts',
  'src/types/interviewer.ts',
  'src/types/organization.ts',
  'src/types/response.ts',
  'src/types/user.ts',
];

export const isImportedApp = (relativePath) =>
  IMPORTED_APP_PREFIXES.some((prefix) => relativePath === prefix || relativePath.startsWith(prefix));
