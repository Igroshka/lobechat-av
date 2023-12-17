import type { Locales } from '@/types/locale';

import _resources from './resources';

type LocaleOptions = {
  label: string;
  value: Locales;
}[];

export const localeOptions: LocaleOptions = [
  {
    label: '简体中文',
    value: 'zh-CN',
  },
  {
    label: '繁體中文',
    value: 'zh-TW',
  },
  {
    label: 'English',
    value: 'en-US',
  },
  {
    label: '日本語',
    value: 'ja-JP',
  },
  {
    label: '한국어',
    value: 'ko-KR',
  },
  {
    label: 'Deutsch',
    value: 'de-DE',
  },
  {
    label: 'Español',
    value: 'es-ES',
  },
  {
    label: 'Français',
    value: 'fr-FR',
  },
  {
    label: 'Português',
    value: 'pt-BR',
  },
  {
    label: 'Russian',
    value: 'ru-RU',
  },
  {
    label: 'Turkish',
    value: 'tr-TR',
  },
] as LocaleOptions;

export const supportLangs: string[] = localeOptions.map((i) => i.value);

export const resources = {
  ..._resources,
  en: _resources['en-US'],
  zh: _resources['zh-CN'],
};

export const supportLocales = Object.keys(resources);
