import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Image, Square, MessageSquare, FileText, Save } from 'lucide-react';
import { chatStream, importNovel, type Chapter } from '../api';

type Mode = 'chat' | 'import';
const MAX_IMPORT_CHARS = 50000;
const AUTO_SAVE_DELAY_MS = 1000;

interface Props {
  chapter: Chapter | null;
  onMessageSent?: () => void;
  onChapterRefresh?: (chapterId: number) => void;
  onGoToManga?: () => void;
}

export default function ChatPanel({ chapter, onMessageSent, onChapterRefresh, onGoToManga }: Props) {
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [mode, setMode] = useState<Mode>('chat');
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamingChapterIdRef = useRef<number | null>(null);
  const userScrolledUp = useRef(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutoSavedChapterIdRef = useRef<number | null>(null);
  const lastAutoSavedTextRef = useRef('');
  const autoSavingRef = useRef(false);
  const chapterIdRef = useRef(chapter?.id ?? null);
  const importTextRef = useRef('');

  // Keep importTextRef in sync with importText state for synchronous access
  importTextRef.current = importText;

  const source = chapter?.content_source ?? null;
  const isImportLocked = source === 'import';
  const isChatLocked = source === 'chat' || (!!chapter && !source && chapter.messages.length > 0);

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  const doImportSave = useCallback(async (chapterId: number, text: string) => {
    if (autoSavingRef.current) return;
    autoSavingRef.current = true;
    try {
      const updated = await importNovel(chapterId, text);
      lastAutoSavedTextRef.current = text;
      lastAutoSavedChapterIdRef.current = chapterId;
      // Only update UI if still on the same chapter
      if (chapterIdRef.current === chapterId) {
        setMessages(updated.messages.map((m) => ({ role: m.role, content: m.content })));
        setImportText(updated.novel_content || text);
        onChapterRefresh?.(chapterId);
      }
    } catch {
      // Auto-save errors are silent
    } finally {
      autoSavingRef.current = false;
    }
  }, [onChapterRefresh]);

  const scheduleAutoSave = useCallback((text: string) => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    const chapterId = chapterIdRef.current;
    if (!chapterId || isImportLocked || isChatLocked) return;
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > MAX_IMPORT_CHARS) return;
    if (trimmed === lastAutoSavedTextRef.current && lastAutoSavedChapterIdRef.current === chapterId) return;
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      if (chapterIdRef.current === chapterId && !isImportLocked && !isChatLocked) {
        doImportSave(chapterId, trimmed);
      }
    }, AUTO_SAVE_DELAY_MS);
  }, [isImportLocked, isChatLocked, doImportSave]);

  // ── Chapter-switch: save old chapter content, then load new ──

  useEffect(() => {
    const prevChapterId = chapterIdRef.current;
    const prevImportText = importTextRef.current.trim();
    const newChapterId = chapter?.id ?? null;
    const isDifferentChapter = prevChapterId !== newChapterId;

    // Cancel any pending auto-save timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    // CRITICAL: Save previous chapter's pending import text before switching
    if (isDifferentChapter && prevChapterId && prevImportText &&
        prevImportText.length <= MAX_IMPORT_CHARS &&
        prevImportText !== lastAutoSavedTextRef.current) {
      // Fire-and-forget save — we don't block chapter switch on this
      importNovel(prevChapterId, prevImportText).then(() => {
        lastAutoSavedTextRef.current = prevImportText;
        lastAutoSavedChapterIdRef.current = prevChapterId;
      }).catch(() => {});
    }

    // Abort any in-progress stream for the previous chapter
    if (abortRef.current) {
      const abortedChapterId = streamingChapterIdRef.current;
      abortRef.current.abort();
      abortRef.current = null;
      if (abortedChapterId !== null) {
        window.setTimeout(() => onChapterRefresh?.(abortedChapterId), 500);
      }
    }
    streamingChapterIdRef.current = null;
    autoSavingRef.current = false;

    // Update chapter tracking ref
    chapterIdRef.current = newChapterId;

    // Reset state for the new chapter (synchronous, React batches these)
    if (chapter) {
      setMessages(chapter.messages.map((m) => ({ role: m.role, content: m.content })));
      setImportText(chapter.content_source === 'import' ? chapter.novel_content || '' : '');
      setMode(chapter.content_source === 'import' ? 'import' : 'chat');
      lastAutoSavedTextRef.current = chapter.content_source === 'import' ? (chapter.novel_content || '') : '';
      lastAutoSavedChapterIdRef.current = chapter.id;
    } else {
      setMessages([]);
      setImportText('');
      setMode('chat');
      lastAutoSavedTextRef.current = '';
      lastAutoSavedChapterIdRef.current = null;
    }
    setImportError('');
    setStreamContent('');
    setStreaming(false);
  }, [chapter?.id]);

  // Auto-scroll only if user hasn't scrolled up.
  useEffect(() => {
    if (!userScrolledUp.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: streaming ? 'instant' : 'smooth' });
    }
  }, [messages, streamContent]);

  // Reset scroll lock when user sends a new message
  useEffect(() => {
    userScrolledUp.current = false;
  }, [messages.length]);

  // Detect manual scroll
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const handleScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      userScrolledUp.current = !atBottom;
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  const handleSend = () => {
    if (!input.trim() || !chapter || streaming || isImportLocked) return;
    const userMsg = { role: 'user', content: input.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setStreaming(true);
    setStreamContent('');

    let accumulated = '';
    streamingChapterIdRef.current = chapter.id;
    abortRef.current = chatStream(
      chapter.id,
      userMsg.content,
      (token) => {
        accumulated += token;
        setStreamContent(accumulated);
      },
      (fullContent) => {
        abortRef.current = null;
        streamingChapterIdRef.current = null;
        setMessages((prev) => [...prev, { role: 'assistant', content: fullContent }]);
        setStreamContent('');
        setStreaming(false);
        onMessageSent?.();
      },
      (err) => {
        abortRef.current = null;
        streamingChapterIdRef.current = null;
        setMessages((prev) => [...prev, { role: 'assistant', content: `错误: ${err}` }]);
        setStreamContent('');
        setStreaming(false);
      },
    );
  };

  const handleAbort = () => {
    const abortedChapterId = streamingChapterIdRef.current;
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    streamingChapterIdRef.current = null;
    if (streamContent) {
      setMessages((prev) => [...prev, { role: 'assistant', content: streamContent + '\n\n[已中止]' }]);
    }
    setStreamContent('');
    setStreaming(false);
    window.setTimeout(() => {
      if (abortedChapterId !== null) {
        onChapterRefresh?.(abortedChapterId);
      } else {
        onMessageSent?.();
      }
    }, 500);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleImportSave = async () => {
    if (!chapter || importing || isChatLocked) return;
    const text = importText.trim();
    if (!text) {
      setImportError('请输入小说内容');
      return;
    }
    if (text.length > MAX_IMPORT_CHARS) {
      setImportError(`内容过长，请控制在 ${MAX_IMPORT_CHARS} 字以内（当前 ${text.length} 字）`);
      return;
    }
    // Cancel any pending auto-save
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    setImporting(true);
    setImportError('');
    try {
      const updated = await importNovel(chapter.id, text);
      lastAutoSavedTextRef.current = text;
      lastAutoSavedChapterIdRef.current = chapter.id;
      setMessages(updated.messages.map((m) => ({ role: m.role, content: m.content })));
      setImportText(updated.novel_content || text);
      onChapterRefresh?.(chapter.id);
    } catch (err: any) {
      setImportError(err.message || '保存失败');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0f0f1a]">
      {/* Header with mode tabs */}
      <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-800 tracking-wide uppercase shrink-0">
          第 {chapter?.chapter_number ?? '–'} 话
        </h2>
        <div className="flex items-center gap-1 bg-gray-50 rounded-lg p-1 border border-gray-200">
          <button
            onClick={() => setMode('chat')}
            disabled={streaming || isImportLocked}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              mode === 'chat'
                ? 'bg-blue-600 text-gray-950'
                : 'text-gray-600 hover:text-gray-800 disabled:opacity-30 disabled:cursor-not-allowed'
            }`}
          >
            <MessageSquare size={12} />
            AI 对话
          </button>
          <button
            onClick={() => setMode('import')}
            disabled={streaming || isChatLocked}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              mode === 'import'
                ? 'bg-blue-600 text-gray-950'
                : 'text-gray-600 hover:text-gray-800 disabled:opacity-30 disabled:cursor-not-allowed'
            }`}
          >
            <FileText size={12} />
            粘贴小说
          </button>
        </div>
      </div>

      {mode === 'import' ? (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="px-5 pt-4 pb-2 text-xs text-gray-500 leading-relaxed shrink-0">
            {isImportLocked
              ? '本话已导入小说，不能再使用 AI 对话。右侧「漫画」面板可继续生成分镜与漫画图片。'
              : isChatLocked
                ? '本话已使用 AI 对话创作，不能再粘贴小说。请新建下一话后导入已有小说。'
                : '将你已有的小说内容粘贴到下方，保存后本话将锁定为「粘贴小说」模式。'}
          </div>
          <div className="flex-1 px-5 pb-3 min-h-0">
            <textarea
              value={importText}
              onChange={(e) => {
                const val = e.target.value;
                setImportText(val);
                if (importError) setImportError('');
                scheduleAutoSave(val);
              }}
              disabled={isImportLocked || isChatLocked}
              placeholder={`粘贴小说全文…（最长 ${MAX_IMPORT_CHARS} 字）`}
              className="w-full h-full bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-800
                         placeholder-gray-400 resize-none outline-none focus:border-blue-600 transition-colors disabled:opacity-70
                         font-mono leading-relaxed"
            />
          </div>
          <div className="px-5 pb-4 shrink-0 flex items-center justify-between gap-3">
            <div className="text-xs text-gray-500">
              {importText.length.toLocaleString()} / {MAX_IMPORT_CHARS.toLocaleString()} 字
              {importError && <span className="ml-3 text-red-400">{importError}</span>}
            </div>
            <button
              onClick={handleImportSave}
              disabled={!chapter || importing || isImportLocked || isChatLocked || !importText.trim()}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg
                         bg-blue-600 hover:bg-blue-500 text-gray-950
                         disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <Save size={13} />
              {isImportLocked ? '已导入' : importing ? '保存中…' : '保存小说'}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Messages */}
          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {messages.length === 0 && !streaming && (
              <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                开始和 AI 讨论你的小说创意吧…
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-gray-950 rounded-br-md'
                      : 'bg-gray-100 text-gray-800 rounded-bl-md'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {streaming && !streamContent && (
              <div className="flex justify-start">
                <div className="flex items-center gap-3 px-4 py-3 rounded-2xl rounded-bl-md bg-gray-100">
                  <svg className="w-5 h-5 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="text-sm text-gray-600">AI 思考中…</span>
                </div>
              </div>
            )}
            {streaming && streamContent && (
              <div className="flex justify-start">
                <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-bl-md bg-gray-100 text-gray-800 text-sm leading-relaxed whitespace-pre-wrap">
                  {streamContent}
                  <span className="inline-block w-1.5 h-4 ml-0.5 bg-blue-500 animate-pulse rounded-sm" />
                </div>
              </div>
            )}
            {/* Mobile: Go to manga button */}
            {onGoToManga && messages.length > 0 && !streaming && (
              <div className="flex justify-center py-3">
                <button
                  onClick={onGoToManga}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg
                         bg-blue-600/20 hover:bg-blue-600/30 text-blue-500 border border-blue-700/50
                         transition-colors"
                >
                  <Image size={14} />
                  查看漫画 / 生成分镜
                </button>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="px-4 py-3 border-t border-gray-200">
            <div className="flex items-end gap-2 bg-gray-50 rounded-xl px-3 py-2 border border-gray-200 focus-within:border-blue-600 transition-colors">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  autoResize(e.target);
                }}
                onKeyDown={handleKeyDown}
                placeholder="描述你的小说想法…"
                disabled={isImportLocked}
                rows={1}
                className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 resize-none outline-none disabled:opacity-50"
                style={{ maxHeight: '160px', overflow: 'auto' }}
              />
              {streaming ? (
                <button
                  onClick={handleAbort}
                  className="p-2 rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors shrink-0"
                  title="停止生成"
                >
                  <Square size={16} />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isImportLocked}
                  className="p-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-gray-950 disabled:opacity-30
                         disabled:cursor-not-allowed transition-colors shrink-0"
                >
                  <Send size={16} />
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
