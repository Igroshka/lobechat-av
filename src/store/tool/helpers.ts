import { LobeChatPluginManifest, PluginSchema } from '@lobehub/chat-plugin-sdk';

import { LobeTool } from '@/types/tool';

const getPluginFormList = (list: LobeTool[], id: string) => list?.find((p) => p.identifier === id);

const getPluginTitle = (meta?: LobeChatPluginManifest['meta']) => meta?.title;
const getPluginDesc = (meta?: LobeChatPluginManifest['meta']) => meta?.description;

const getPluginTags = (meta?: LobeChatPluginManifest['meta']) => meta?.tags;
const getPluginAvatar = (meta?: LobeChatPluginManifest['meta']) => meta?.avatar || '🧩';

const isCustomPlugin = (id: string, pluginList: LobeTool[]) =>
  pluginList.some((i) => i.identifier === id && i.type === 'customPlugin');

const isSettingSchemaNonEmpty = (schema?: PluginSchema) =>
  schema?.properties && Object.keys(schema.properties).length > 0;

export const pluginHelpers = {
  getPluginAvatar,
  getPluginDesc,
  getPluginFormList,
  getPluginTags,
  getPluginTitle,
  isCustomPlugin,
  isSettingSchemaNonEmpty,
};
