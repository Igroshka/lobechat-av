import { act, renderHook, waitFor } from '@testing-library/react';
import useSWR, { mutate } from 'swr';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOADING_FLAT } from '@/const/message';
import { chatService } from '@/services/chat';
import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
import { chatSelectors } from '@/store/chat/selectors';
import { ChatMessage } from '@/types/chatMessage';

import { useChatStore } from '../store';

// Mock service
vi.mock('@/services/message', () => ({
  messageService: {
    getMessages: vi.fn(),
    updateMessageError: vi.fn(),
    removeMessage: vi.fn(),
    createAssistantMessage: vi.fn(() => Promise.resolve('content-content-content')),
    removeMessages: vi.fn(() => Promise.resolve()),
    create: vi.fn(() => Promise.resolve('new-message-id')),
    updateMessageContent: vi.fn(),
    clearAllMessage: vi.fn(() => Promise.resolve()),
  },
}));
vi.mock('@/services/topic', () => ({
  topicService: {
    removeTopic: vi.fn(() => Promise.resolve()),
  },
}));
vi.mock('@/services/chat', () => ({
  chatService: {
    createAssistantMessage: vi.fn(() => Promise.resolve('assistant-message')),
  },
}));

vi.mock('@/store/chat/selectors', () => ({
  chatSelectors: {
    currentChats: vi.fn(),
  },
}));

const realCoreProcessMessage = useChatStore.getState().coreProcessMessage;
const realRefreshMessages = useChatStore.getState().refreshMessages;
// Mock state
const mockState = {
  activeId: 'session-id',
  activeTopicId: 'topic-id',
  messages: [],
  refreshMessages: vi.fn(),
  refreshTopic: vi.fn(),
  coreProcessMessage: vi.fn(),
  saveToTopic: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  useChatStore.setState(mockState, false);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('chatMessage actions', () => {
  it('clearMessage should remove messages from the active session and topic', async () => {
    const { result } = renderHook(() => useChatStore());
    const clearSpy = vi.spyOn(result.current, 'clearMessage');
    const switchTopicSpy = vi.spyOn(result.current, 'switchTopic');

    await act(async () => {
      await result.current.clearMessage();
    });

    expect(clearSpy).toHaveBeenCalled();
    expect(result.current.refreshMessages).toHaveBeenCalled();
    expect(result.current.refreshTopic).toHaveBeenCalled();
    expect(switchTopicSpy).toHaveBeenCalled();
  });

  it('deleteMessage should remove a message by id', async () => {
    const { result } = renderHook(() => useChatStore());
    const messageId = 'message-id';
    const deleteSpy = vi.spyOn(result.current, 'deleteMessage');

    await act(async () => {
      await result.current.deleteMessage(messageId);
    });

    expect(deleteSpy).toHaveBeenCalledWith(messageId);
    expect(result.current.refreshMessages).toHaveBeenCalled();
  });

  it('clearAllMessages should remove all messages', async () => {
    const { result } = renderHook(() => useChatStore());
    const clearAllSpy = vi.spyOn(result.current, 'clearAllMessages');

    await act(async () => {
      await result.current.clearAllMessages();
    });

    expect(clearAllSpy).toHaveBeenCalled();
    expect(result.current.refreshMessages).toHaveBeenCalled();
  });

  it('updateInputMessage should update the input message state', () => {
    const { result } = renderHook(() => useChatStore());
    const newInputMessage = 'Updated message';
    act(() => {
      result.current.updateInputMessage(newInputMessage);
    });

    expect(result.current.inputMessage).toEqual(newInputMessage);
  });

  describe('clearMessage', () => {
    beforeEach(() => {
      vi.clearAllMocks(); // 清除 mocks
      useChatStore.setState(mockState, false); // 重置 state
    });

    afterEach(() => {
      vi.restoreAllMocks(); // 恢复所有模拟
    });

    it('should remove messages from the active session and topic, then refresh topics and messages', async () => {
      const { result } = renderHook(() => useChatStore());
      const switchTopicSpy = vi.spyOn(result.current, 'switchTopic');
      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic');

      await act(async () => {
        await result.current.clearMessage();
      });

      expect(mockState.refreshMessages).toHaveBeenCalled();
      expect(refreshTopicSpy).toHaveBeenCalled();
      expect(switchTopicSpy).toHaveBeenCalled();

      // 检查 activeTopicId 是否被清除，需要在状态更新后进行检查
      expect(useChatStore.getState().activeTopicId).toBeUndefined();
    });

    it('should call removeTopic if there is an activeTopicId', async () => {
      const { result } = renderHook(() => useChatStore());
      const switchTopicSpy = vi.spyOn(result.current, 'switchTopic');
      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic');

      await act(async () => {
        await result.current.clearMessage();
      });

      expect(mockState.activeTopicId).not.toBeUndefined(); // 确保在测试前 activeTopicId 存在
      expect(refreshTopicSpy).toHaveBeenCalled();
      expect(mockState.refreshMessages).toHaveBeenCalled();
      expect(topicService.removeTopic).toHaveBeenCalledWith(mockState.activeTopicId);
      expect(switchTopicSpy).toHaveBeenCalled();
    });
  });

  describe('sendMessage', () => {
    it('should not send message if there is no active session', async () => {
      useChatStore.setState({ activeId: undefined });
      const { result } = renderHook(() => useChatStore());
      const message = 'Test message';

      await act(async () => {
        await result.current.sendMessage(message);
      });

      expect(messageService.create).not.toHaveBeenCalled();
      expect(result.current.refreshMessages).not.toHaveBeenCalled();
      expect(result.current.coreProcessMessage).not.toHaveBeenCalled();
    });

    it('should not send message if message is empty and there are no files', async () => {
      const { result } = renderHook(() => useChatStore());
      const message = '';

      await act(async () => {
        await result.current.sendMessage(message);
      });

      expect(messageService.create).not.toHaveBeenCalled();
      expect(result.current.refreshMessages).not.toHaveBeenCalled();
      expect(result.current.coreProcessMessage).not.toHaveBeenCalled();
    });

    it('should not send message if message is empty and there are empty files', async () => {
      const { result } = renderHook(() => useChatStore());
      const message = '';

      await act(async () => {
        await result.current.sendMessage(message, []);
      });

      expect(messageService.create).not.toHaveBeenCalled();
      expect(result.current.refreshMessages).not.toHaveBeenCalled();
      expect(result.current.coreProcessMessage).not.toHaveBeenCalled();
    });

    it('should create message and call coreProcessMessage if message or files are provided', async () => {
      const { result } = renderHook(() => useChatStore());
      const message = 'Test message';
      const files = [{ id: 'file-id', url: 'file-url' }];

      // Mock messageService.create to resolve with a message id
      (messageService.create as Mock).mockResolvedValue('new-message-id');

      await act(async () => {
        await result.current.sendMessage(message, files);
      });

      expect(messageService.create).toHaveBeenCalledWith({
        content: message,
        files: files.map((f) => f.id),
        role: 'user',
        sessionId: mockState.activeId,
        topicId: mockState.activeTopicId,
      });
      expect(result.current.refreshMessages).toHaveBeenCalled();
      expect(result.current.coreProcessMessage).toHaveBeenCalled();
    });

    // it('should auto-create topic and switch to it if enabled and threshold is reached', async () => {
    //   const { result } = renderHook(() => useChatStore());
    //   const message = 'Test message';
    //   const autoCreateTopicThreshold = 5;
    //   const enableAutoCreateTopic = true;
    //
    //   // Mock state with the necessary settings
    //   useChatStore.setState({
    //     ...mockState,
    //     messages: Array(autoCreateTopicThreshold).fill({}), // Fill with dummy messages to reach threshold
    //   });
    //
    //   // Mock messageService.create to resolve with a message id
    //   (messageService.create as vi.Mock).mockResolvedValue('new-message-id');
    //
    //   await act(async () => {
    //     await result.current.sendMessage(message);
    //   });
    //
    //   expect(result.current.saveToTopic).toHaveBeenCalled();
    //   expect(result.current.switchTopic).toHaveBeenCalled();
    // });
    // 其他可能的测试用例...
  });

  describe('resendMessage action', () => {
    it('should resend a message by id and refresh messages', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';

      // Mock the currentChats selector to return a list that includes the message to be resent
      (chatSelectors.currentChats as Mock).mockReturnValue([
        // ... other messages
        { id: messageId, role: 'user', content: 'Resend this message' },
        // ... other messages
      ]);

      // Mock the coreProcessMessage function to resolve immediately
      mockState.coreProcessMessage.mockResolvedValue(undefined);

      await act(async () => {
        await result.current.resendMessage(messageId);
      });

      expect(messageService.removeMessage).not.toHaveBeenCalledWith(messageId);
      expect(mockState.coreProcessMessage).toHaveBeenCalledWith(expect.any(Array), messageId);
    });

    it('should not perform any action if the message id does not exist', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'non-existing-message-id';

      // Mock the currentChats selector to return a list that does not include the message to be resent
      (chatSelectors.currentChats as Mock).mockReturnValue([
        // ... other messages
      ]);

      await act(async () => {
        await result.current.resendMessage(messageId);
      });

      expect(messageService.removeMessage).not.toHaveBeenCalledWith(messageId);
      expect(mockState.coreProcessMessage).not.toHaveBeenCalled();
      expect(mockState.refreshMessages).not.toHaveBeenCalled();
    });
  });

  describe('updateMessageContent action', () => {
    it('should call messageService.updateMessageContent with correct parameters', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const newContent = 'Updated content';

      await act(async () => {
        await result.current.updateMessageContent(messageId, newContent);
      });

      expect(messageService.updateMessageContent).toHaveBeenCalledWith(messageId, newContent);
    });

    it('should dispatch message update action', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const newContent = 'Updated content';
      const dispatchMessageSpy = vi.spyOn(result.current, 'dispatchMessage');

      await act(async () => {
        await result.current.updateMessageContent(messageId, newContent);
      });

      expect(dispatchMessageSpy).toHaveBeenCalledWith({
        id: messageId,
        key: 'content',
        type: 'updateMessage',
        value: newContent,
      });
    });

    it('should refresh messages after updating content', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const newContent = 'Updated content';

      await act(async () => {
        await result.current.updateMessageContent(messageId, newContent);
      });

      expect(result.current.refreshMessages).toHaveBeenCalled();
    });
  });

  describe('coreProcessMessage action', () => {
    it('should handle the core AI message processing', async () => {
      useChatStore.setState({ coreProcessMessage: realCoreProcessMessage });

      const { result } = renderHook(() => useChatStore());
      const userMessage = {
        id: 'user-message-id',
        role: 'user',
        content: 'Hello, world!',
        sessionId: mockState.activeId,
        topicId: mockState.activeTopicId,
      } as ChatMessage;
      const messages = [userMessage];

      // 模拟 AI 响应
      const aiResponse = 'Hello, human!';
      (chatService.createAssistantMessage as Mock).mockResolvedValue(aiResponse);

      // 模拟消息创建
      (messageService.create as Mock).mockResolvedValue('assistant-message-id');

      await act(async () => {
        await result.current.coreProcessMessage(messages, userMessage.id);
      });

      // 验证是否创建了代表 AI 响应的消息
      expect(messageService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'assistant',
          content: LOADING_FLAT,
          fromModel: expect.anything(),
          parentId: userMessage.id,
          sessionId: mockState.activeId,
          topicId: mockState.activeTopicId,
        }),
      );

      // 验证 AI 服务是否被调用
      expect(chatService.createAssistantMessage).toHaveBeenCalled();

      // 验证消息列表是否刷新
      expect(mockState.refreshMessages).toHaveBeenCalled();
    });
  });

  describe('stopGenerateMessage action', () => {
    it('should stop generating message and set loading states correctly', async () => {
      const { result } = renderHook(() => useChatStore());
      const toggleChatLoadingSpy = vi.spyOn(result.current, 'toggleChatLoading');
      const abortController = new AbortController();

      act(() => {
        useChatStore.setState({ abortController });
      });

      await act(async () => {
        result.current.stopGenerateMessage();
      });

      expect(abortController.signal.aborted).toBe(true);
      expect(toggleChatLoadingSpy).toHaveBeenCalledWith(false, undefined, expect.any(String));
    });

    it('should not do anything if there is no abortController', async () => {
      const { result } = renderHook(() => useChatStore());

      // 确保没有设置 abortController
      useChatStore.setState({ abortController: undefined });

      await act(async () => {
        result.current.stopGenerateMessage();
      });

      // 由于没有 abortController，不应调用任何方法
      expect(result.current.abortController).toBeUndefined();
    });
  });

  describe('refreshMessages action', () => {
    beforeEach(() => {
      vi.mock('swr', async () => {
        const actual = await vi.importActual('swr');
        return {
          ...(actual as any),
          mutate: vi.fn(),
        };
      });
    });
    afterEach(() => {
      // 在每个测试用例开始前恢复到实际的 SWR 实现
      vi.resetAllMocks();
    });
    it('should refresh messages by calling mutate with current activeId and activeTopicId', async () => {
      useChatStore.setState({ refreshMessages: realRefreshMessages });

      const { result } = renderHook(() => useChatStore());
      const activeId = useChatStore.getState().activeId;
      const activeTopicId = useChatStore.getState().activeTopicId;

      // 在这里，我们不需要再次模拟 mutate，因为它已经在顶部被模拟了
      await act(async () => {
        await result.current.refreshMessages();
      });

      // 确保 mutate 调用了正确的参数
      expect(mutate).toHaveBeenCalledWith([activeId, activeTopicId]);
    });
    it('should handle errors during refreshing messages', async () => {
      useChatStore.setState({ refreshMessages: realRefreshMessages });
      const { result } = renderHook(() => useChatStore());

      // 设置模拟错误
      (mutate as Mock).mockImplementation(() => {
        throw new Error('Mutate error');
      });

      await act(async () => {
        await expect(result.current.refreshMessages()).rejects.toThrow('Mutate error');
      });

      // 确保恢复 mutate 的模拟，以免影响其他测试
      (mutate as Mock).mockReset();
    });
  });

  describe('useFetchMessages hook', () => {
    // beforeEach(() => {
    //   vi.mocked(useSWR).mockRestore();
    // });

    it('should fetch messages for given session and topic ids', async () => {
      const sessionId = 'session-id';
      const topicId = 'topic-id';
      const messages = [{ id: 'message-id', content: 'Hello' }];

      // 设置模拟返回值
      (messageService.getMessages as Mock).mockResolvedValue(messages);

      const { result } = renderHook(() => useChatStore().useFetchMessages(sessionId, topicId));

      // 等待异步操作完成
      await waitFor(() => {
        expect(result.current.data).toEqual(messages);
      });
    });
  });
});
