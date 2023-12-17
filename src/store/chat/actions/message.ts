/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
// Note: DON'T REMOVE THE FIRST LINE
// Disable the auto sort key eslint rule to make the code more logic and readable
import { template } from 'lodash-es';
import useSWR, { SWRResponse, mutate } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { VISION_MODEL_WHITE_LIST } from '@/const/llm';
import { LOADING_FLAT } from '@/const/message';
import { VISION_MODEL_DEFAULT_MAX_TOKENS } from '@/const/settings';
import { CreateMessageParams } from '@/database/models/message';
import { DB_Message } from '@/database/schemas/message';
import { chatService } from '@/services/chat';
import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
import { chatHelpers } from '@/store/chat/helpers';
import { ChatStore } from '@/store/chat/store';
import { useSessionStore } from '@/store/session';
import { agentSelectors } from '@/store/session/selectors';
import { ChatMessage } from '@/types/chatMessage';
import { fetchSSE } from '@/utils/fetch';
import { isFunctionMessageAtStart, testFunctionMessageAtEnd } from '@/utils/message';
import { setNamespace } from '@/utils/storeDebug';

import { MessageDispatch, messagesReducer } from '../reducers/message';
import { chatSelectors } from '../selectors';

const n = setNamespace('message');

export interface ChatMessageAction {
  // create
  resendMessage: (id: string) => Promise<void>;
  sendMessage: (text: string, images?: { id: string; url: string }[]) => Promise<void>;
  // delete
  /**
   * clear message on the active session
   */
  clearMessage: () => Promise<void>;
  deleteMessage: (id: string) => Promise<void>;
  clearAllMessages: () => Promise<void>;
  // update
  updateInputMessage: (message: string) => void;
  updateMessageContent: (id: string, content: string) => Promise<void>;
  // query
  useFetchMessages: (sessionId: string, topicId?: string) => SWRResponse<ChatMessage[]>;
  stopGenerateMessage: () => void;

  /**
   * update message at the frontend point
   * this method will not update messages to database
   */
  dispatchMessage: (payload: MessageDispatch) => void;
  /**
   * core process of the AI message (include preprocess and postprocess)
   */
  coreProcessMessage: (messages: ChatMessage[], parentId: string) => Promise<void>;
  /**
   * 实际获取 AI 响应
   * @param messages - 聊天消息数组
   * @param options - 获取 SSE 选项
   */
  fetchAIChatMessage: (
    messages: ChatMessage[],
    assistantMessageId: string,
  ) => Promise<{
    content: string;
    functionCallAtEnd: boolean;
    functionCallContent: string;
    isFunctionCall: boolean;
  }>;
  toggleChatLoading: (
    loading: boolean,
    id?: string,
    action?: string,
  ) => AbortController | undefined;
  refreshMessages: () => Promise<void>;
}

const getAgentConfig = () => agentSelectors.currentAgentConfig(useSessionStore.getState());

export const chatMessage: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatMessageAction
> = (set, get) => ({
  deleteMessage: async (id) => {
    await messageService.removeMessage(id);
    await get().refreshMessages();
  },
  clearMessage: async () => {
    const { activeId, activeTopicId, refreshMessages, refreshTopic, switchTopic } = get();

    await messageService.removeMessages(activeId, activeTopicId);

    if (activeTopicId) {
      await topicService.removeTopic(activeTopicId);
    }
    await refreshTopic();
    await refreshMessages();

    // after remove topic , go back to default topic
    switchTopic();
  },
  clearAllMessages: async () => {
    const { refreshMessages } = get();
    await messageService.clearAllMessage();
    await refreshMessages();
  },
  resendMessage: async (messageId) => {
    // 1. 构造所有相关的历史记录
    const chats = chatSelectors.currentChats(get());

    const currentIndex = chats.findIndex((c) => c.id === messageId);
    if (currentIndex < 0) return;

    const currentMessage = chats[currentIndex];

    let contextMessages: ChatMessage[] = [];

    switch (currentMessage.role) {
      case 'function':
      case 'user': {
        contextMessages = chats.slice(0, currentIndex + 1);
        break;
      }
      case 'assistant': {
        // 消息是 AI 发出的因此需要找到它的 user 消息
        const userId = currentMessage.parentId;
        const userIndex = chats.findIndex((c) => c.id === userId);
        // 如果消息没有 parentId，那么同 user/function 模式
        contextMessages = chats.slice(0, userIndex < 0 ? currentIndex + 1 : userIndex + 1);
        break;
      }
    }

    if (contextMessages.length <= 0) return;

    const { coreProcessMessage } = get();

    const latestMsg = contextMessages.filter((s) => s.role === 'user').at(-1);

    if (!latestMsg) return;

    await coreProcessMessage(contextMessages, latestMsg.id);
  },
  sendMessage: async (message, files) => {
    const { coreProcessMessage, activeTopicId, activeId } = get();
    if (!activeId) return;

    const fileIdList = files?.map((f) => f.id);

    // if message is empty and no files, then stop
    if (!message && (!fileIdList || fileIdList?.length === 0)) return;

    let newMessage: CreateMessageParams = {
      content: message,
      // if message has attached with files, then add files to message and the agent
      files: fileIdList,
      role: 'user',
      sessionId: activeId,
      // if there is activeTopicId，then add topicId to message
      topicId: activeTopicId,
    };

    const id = await messageService.create(newMessage);
    await get().refreshMessages();

    // Get the current messages to generate AI response
    const messages = chatSelectors.currentChats(get());

    await coreProcessMessage(messages, id);

    // check activeTopic and then auto create topic
    const chats = chatSelectors.currentChats(get());

    const agentConfig = getAgentConfig();
    // if autoCreateTopic is false, then stop
    if (!agentConfig.enableAutoCreateTopic) return;

    if (!activeTopicId && chats.length >= agentConfig.autoCreateTopicThreshold) {
      const { saveToTopic, switchTopic } = get();
      const id = await saveToTopic();
      if (id) switchTopic(id);
    }
  },

  stopGenerateMessage: () => {
    const { abortController, toggleChatLoading } = get();
    if (!abortController) return;

    abortController.abort();

    toggleChatLoading(false, undefined, n('stopGenerateMessage') as string);
  },
  updateInputMessage: (message) => {
    set({ inputMessage: message }, false, n('updateInputMessage', message));
  },
  updateMessageContent: async (id, content) => {
    const { dispatchMessage, refreshMessages } = get();

    // Due to the async update method and refresh need about 100ms
    // we need to update the message content at the frontend to avoid the update flick
    // refs: https://medium.com/@kyledeguzmanx/what-are-optimistic-updates-483662c3e171
    dispatchMessage({ id, key: 'content', type: 'updateMessage', value: content });

    await messageService.updateMessageContent(id, content);
    await refreshMessages();
  },
  useFetchMessages: (sessionId, activeTopicId) =>
    useSWR<ChatMessage[]>(
      [sessionId, activeTopicId],
      async ([sessionId, topicId]: [string, string | undefined]) =>
        messageService.getMessages(sessionId, topicId),
      {
        onSuccess: (messages, key) => {
          set(
            { activeId: sessionId, messages, messagesInit: true },
            false,
            n('useFetchMessages', {
              messages,
              queryKey: key,
            }),
          );
        },
        // default is 2000ms ,it makes the user's quick switch don't work correctly.
        // Cause issue like this: https://github.com/lobehub/lobe-chat/issues/532
        // we need to set it to 0.
        dedupingInterval: 0,
      },
    ),
  refreshMessages: async () => {
    await mutate([get().activeId, get().activeTopicId]);
  },

  // the internal process method of the AI message
  coreProcessMessage: async (messages, userMessageId) => {
    const { fetchAIChatMessage, triggerFunctionCall, refreshMessages, activeTopicId } = get();

    const { model } = getAgentConfig();

    // 1. Add an empty message to place the AI response
    const assistantMessage: DB_Message = {
      role: 'assistant',
      content: LOADING_FLAT,
      fromModel: model,

      parentId: userMessageId,
      sessionId: get().activeId,
      topicId: activeTopicId, // if there is activeTopicId，then add it to topicId
    };

    const mid = await messageService.create(assistantMessage);
    await refreshMessages();

    // 2. fetch the AI response
    const { isFunctionCall, content, functionCallAtEnd, functionCallContent } =
      await fetchAIChatMessage(messages, mid);

    // 3. if it's the function call message, trigger the function method
    if (isFunctionCall) {
      let functionId = mid;

      // if the function call is at the end of the message, then create a new function message
      if (functionCallAtEnd) {
        // create a new separate message and remove the function call from the prev message

        await messageService.updateMessageContent(mid, content.replace(functionCallContent, ''));

        const functionMessage: CreateMessageParams = {
          role: 'function',
          content: functionCallContent,
          extra: {
            fromModel: model,
          },
          parentId: userMessageId,
          sessionId: get().activeId,
          topicId: activeTopicId,
        };
        functionId = await messageService.create(functionMessage);
      }

      await refreshMessages();
      await triggerFunctionCall(functionId);
    }
  },
  dispatchMessage: (payload) => {
    const { activeId } = get();

    if (!activeId) return;

    const messages = messagesReducer(get().messages, payload);

    set({ messages }, false, n(`dispatchMessage/${payload.type}`, payload));
  },
  fetchAIChatMessage: async (messages, assistantId) => {
    const { toggleChatLoading, refreshMessages } = get();

    const abortController = toggleChatLoading(
      true,
      assistantId,
      n('generateMessage(start)', { assistantId, messages }) as string,
    );

    const config = getAgentConfig();

    const compiler = template(config.inputTemplate, { interpolate: /{{([\S\s]+?)}}/g });

    // ================================== //
    //   messages uniformly preprocess    //
    // ================================== //

    // 1. slice messages with config
    let preprocessMsgs = chatHelpers.getSlicedMessagesWithConfig(messages, config);

    // 2. replace inputMessage template
    preprocessMsgs = !config.inputTemplate
      ? preprocessMsgs
      : preprocessMsgs.map((m) => {
          if (m.role === 'user') {
            try {
              return { ...m, content: compiler({ text: m.content }) };
            } catch (error) {
              console.error(error);

              return m;
            }
          }

          return m;
        });

    // 3. add systemRole
    if (config.systemRole) {
      preprocessMsgs.unshift({ content: config.systemRole, role: 'system' } as ChatMessage);
    }

    // 4. handle config for the vision model
    // Due to vision model's default max_tokens is very small
    // we need to set the max_tokens a larger one.
    if (VISION_MODEL_WHITE_LIST.includes(config.model)) {
      /* eslint-disable unicorn/no-lonely-if */
      if (!config.params.max_tokens) config.params.max_tokens = VISION_MODEL_DEFAULT_MAX_TOKENS;
    }

    const fetcher = () =>
      chatService.createAssistantMessage(
        {
          messages: preprocessMsgs,
          model: config.model,
          ...config.params,
          plugins: config.plugins,
        },
        { signal: abortController?.signal },
      );

    let output = '';
    let isFunctionCall = false;
    let functionCallAtEnd = false;
    let functionCallContent = '';

    await fetchSSE(fetcher, {
      onErrorHandle: async (error) => {
        await messageService.updateMessageError(assistantId, error);
        await refreshMessages();
      },
      onFinish: async (content) => {
        // update the content after fetch result
        await messageService.updateMessageContent(assistantId, content);
        await refreshMessages();
      },
      onMessageHandle: async (text) => {
        output += text;

        await messageService.updateMessageContent(assistantId, output);
        await refreshMessages();

        // is this message is just a function call
        if (isFunctionMessageAtStart(output)) isFunctionCall = true;
      },
    });

    toggleChatLoading(false, undefined, n('generateMessage(end)') as string);

    // also exist message like this:
    // 请稍等，我帮您查询一下。{"function_call": {"name": "plugin-identifier____recommendClothes____standalone", "arguments": "{\n "mood": "",\n "gender": "man"\n}"}}
    if (!isFunctionCall) {
      const { content, valid } = testFunctionMessageAtEnd(output);

      // if fc at end, replace the message
      if (valid) {
        isFunctionCall = true;
        functionCallAtEnd = true;
        functionCallContent = content;
      }
    }

    return { content: output, functionCallAtEnd, functionCallContent, isFunctionCall };
  },
  toggleChatLoading: (loading, id, action) => {
    if (loading) {
      const abortController = new AbortController();
      set({ abortController, chatLoadingId: id }, false, action);
      return abortController;
    } else {
      set({ abortController: undefined, chatLoadingId: undefined }, false, action);
    }
  },
});
