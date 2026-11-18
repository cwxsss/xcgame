import { userSettingsInStorage } from '@/store/init';
import { pageLanguage, preferredLanguage, parseStoredObject } from './policy';
import { isNeutralPath } from '@/router/paths';

import type { TLanguage } from '@/i18n/interface';
export * from '@/i18n/interface';

export * from '@/i18n';

export const LanguageMap: { [key in TLanguage]: string } = {
  en: 'English',
  ru: 'Русский',
  'zh-TW': '繁體中文',
  'zh-CN': '简体中文',
  es: 'Español',
  pt: 'Português',
  vi: 'Tiếng Việt',
};

export function selectLocale(): TLanguage {
  const preferred = preferredLanguage(parseStoredObject(userSettingsInStorage), ['zh-CN']);
  const prefix = (process.env.BASE_URL || '/').replace(/\/$/, '');
  const pathname = document.location.pathname.slice(prefix.length) || '/';
  return pageLanguage(pathname, isNeutralPath(pathname), preferred);
}
