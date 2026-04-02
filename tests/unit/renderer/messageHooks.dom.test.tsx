import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MessageListProvider,
  useAddOrUpdateMessage,
  useMessageList,
  useMessageLstCache,
  useRemoveMessageByMsgId,
} from '@/renderer/pages/conversation/Messages/hooks';

const mockGetConversationMessagesInvoke = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    database: {
      getConversationMessages: {
        invoke: (...args: unknown[]) => mockGetConversationMessagesInvoke(...args),
      },
    },
  },
}));

type TestMessage = {
  id: string;
  msg_id?: string;
  conversation_id: string;
  type: string;
  position?: string;
  content: {
    content: string;
  };
  createdAt?: number;
};

const CacheProbe = ({ conversationId }: { conversationId: string }) => {
  useMessageLstCache(conversationId);
  const messages = useMessageList();
  return <pre data-testid='messages'>{JSON.stringify(messages)}</pre>;
};

const MutationProbe = () => {
  const addOrUpdateMessage = useAddOrUpdateMessage();
  const removeMessageByMsgId = useRemoveMessageByMsgId();
  const messages = useMessageList();

  return (
    <div>
      <button
        type='button'
        onClick={() =>
          addOrUpdateMessage(
            {
              id: 'msg-1',
              msg_id: 'msg-1',
              conversation_id: 'conv-1',
              type: 'text',
              position: 'right',
              content: { content: 'queued message' },
            },
            true
          )
        }
      >
        add-message
      </button>
      <button type='button' onClick={() => removeMessageByMsgId('msg-1')}>
        remove-message
      </button>
      <pre data-testid='mutated-messages'>{JSON.stringify(messages)}</pre>
    </div>
  );
};

const StreamingMergeProbe = ({ chunks, msgId = 'stream-msg-1' }: { chunks: string[]; msgId?: string }) => {
  const addOrUpdateMessage = useAddOrUpdateMessage();
  const messages = useMessageList();

  return (
    <div>
      <button
        type='button'
        onClick={() => {
          for (const [index, chunk] of chunks.entries()) {
            addOrUpdateMessage({
              id: `stream-${index}`,
              msg_id: msgId,
              conversation_id: 'conv-1',
              type: 'text',
              position: 'left',
              content: { content: chunk },
            } as TestMessage);
          }
        }}
      >
        merge-stream
      </button>
      <pre data-testid='stream-merged-messages'>{JSON.stringify(messages)}</pre>
    </div>
  );
};

describe('message hooks cache merge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps same-conversation streaming messages while filtering out messages from the previous conversation', async () => {
    const dbMessages: TestMessage[] = [
      {
        id: 'db-1',
        msg_id: 'db-1',
        conversation_id: 'conv-1',
        type: 'text',
        content: { content: 'from db' },
      },
    ];

    mockGetConversationMessagesInvoke.mockResolvedValue(dbMessages);

    const initialMessages: TestMessage[] = [
      {
        id: 'stream-1',
        msg_id: 'stream-1',
        conversation_id: 'conv-1',
        type: 'text',
        content: { content: 'streaming current conversation' },
      },
      {
        id: 'stream-2',
        msg_id: 'stream-2',
        conversation_id: 'conv-2',
        type: 'text',
        content: { content: 'streaming stale conversation' },
      },
    ];

    render(
      <MessageListProvider value={initialMessages}>
        <CacheProbe conversationId='conv-1' />
      </MessageListProvider>
    );

    await waitFor(() => {
      const content = screen.getByTestId('messages').textContent;
      expect(content).toContain('db-1');
      expect(content).toContain('stream-1');
    });

    const merged = JSON.parse(screen.getByTestId('messages').textContent ?? '[]') as TestMessage[];

    expect(merged.map((message) => message.id)).toEqual(['db-1', 'stream-1']);
  });

  it('adds optimistic messages and removes them by msg id', async () => {
    mockGetConversationMessagesInvoke.mockResolvedValue([]);

    render(
      <MessageListProvider value={[]}>
        <MutationProbe />
      </MessageListProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'add-message' }));

    await waitFor(() => {
      expect(screen.getByTestId('mutated-messages').textContent).toContain('msg-1');
    });

    fireEvent.click(screen.getByRole('button', { name: 'remove-message' }));

    await waitFor(() => {
      expect(screen.getByTestId('mutated-messages').textContent).not.toContain('msg-1');
    });
  });

  it('merges streaming text chunks and preserves leading spaces', async () => {
    mockGetConversationMessagesInvoke.mockResolvedValue([]);

    render(
      <MessageListProvider value={[]}>
        <StreamingMergeProbe chunks={['this', ' is']} />
      </MessageListProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'merge-stream' }));

    await waitFor(() => {
      const parsed = JSON.parse(screen.getByTestId('stream-merged-messages').textContent ?? '[]') as TestMessage[];
      expect(parsed).toHaveLength(1);
      expect(parsed[0].content.content).toBe('this is');
    });
  });

  it('preserves blank lines when newline-only chunks are merged', async () => {
    mockGetConversationMessagesInvoke.mockResolvedValue([]);

    render(
      <MessageListProvider value={[]}>
        <StreamingMergeProbe chunks={['line1\n', '\nline2']} />
      </MessageListProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'merge-stream' }));

    await waitFor(() => {
      const parsed = JSON.parse(screen.getByTestId('stream-merged-messages').textContent ?? '[]') as TestMessage[];
      expect(parsed).toHaveLength(1);
      expect(parsed[0].content.content).toBe('line1\n\nline2');
    });
  });

  it('preserves whitespace-only chunks when they are streamed', async () => {
    mockGetConversationMessagesInvoke.mockResolvedValue([]);

    render(
      <MessageListProvider value={[]}>
        <StreamingMergeProbe chunks={['hello', '   ', 'world']} />
      </MessageListProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'merge-stream' }));

    await waitFor(() => {
      const parsed = JSON.parse(screen.getByTestId('stream-merged-messages').textContent ?? '[]') as TestMessage[];
      expect(parsed).toHaveLength(1);
      expect(parsed[0].content.content).toBe('hello   world');
    });
  });
});
