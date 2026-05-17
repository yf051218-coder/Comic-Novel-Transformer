import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, BookOpenText, Trash2, Home, MessageSquare, Image, PanelLeftClose, PanelLeftOpen, KeyRound, ExternalLink, X, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import ChatPanel from './components/ChatPanel';
import MangaPanel from './components/MangaPanel';
import HomePage from './components/HomePage';
import {
  listChapters,
  listStories,
  createNextChapter,
  deleteChapter,
  getChapter,
  type Story,
  type Chapter,
  getApiKeySettings,
  saveApiKeySettings,
  clearApiKeySettings,
  fetchSettings,
  saveSettings,
  validateApiKey,
  API_KEY_CHANGE_EVENT,
  DEEPSEEK_USAGE_URL,
  IMAGE2_CONSOLE_URL,
} from './api';

type View = 'home' | 'editor';
type MobileTab = 'chat' | 'manga';

const LS_STORY_ID = 'lorevista.currentStoryId';
const LS_CHAPTER_ID = 'lorevista.currentChapterId';
const LS_CHAPTER_IDX = 'lorevista.currentChapterIdx';
const MOBILE_BREAKPOINT = 768;

function chapterHash(chapterNumber: number) {
  return `chapter-${chapterNumber}`;
}

function parseChapterNumberHash(): number | null {
  const raw = window.location.hash.replace(/^#/, '');
  const match = raw.match(/^chapter-(\d+)$/);
  return match ? Number(match[1]) : null;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < MOBILE_BREAKPOINT);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

function useApiKeyConfigured() {
  const read = () => {
    const s = getApiKeySettings();
    return { deepseek: !!s.deepseekApiKey, image: !!s.imageApiKey };
  };
  const [state, setState] = useState(read);
  useEffect(() => {
    const sync = () => setState(read());
    window.addEventListener(API_KEY_CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(API_KEY_CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return state;
}

function ApiKeySettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [deepseekApiKey, setDeepseekApiKey] = useState('');
  const [imageApiKey, setImageApiKey] = useState('');
  const [deepseekVisible, setDeepseekVisible] = useState(false);
  const [imageVisible, setImageVisible] = useState(false);
  const [validating, setValidating] = useState<'deepseek' | 'image2' | null>(null);
  const [valStatus, setValStatus] = useState<Record<string, { ok: boolean; error?: string }>>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    const settings = getApiKeySettings();
    setDeepseekApiKey(settings.deepseekApiKey);
    setImageApiKey(settings.imageApiKey);
    setValStatus({});
    setSaveMsg(null);
    setSaving(false);
    setValidating(null);
  }, [open]);

  if (!open) return null;

  const handleValidate = async (provider: 'deepseek' | 'image2') => {
    const key = provider === 'deepseek' ? deepseekApiKey : imageApiKey;
    if (!key.trim()) {
      setValStatus((prev) => ({ ...prev, [provider]: { ok: false, error: '请先输入 API Key' } }));
      return;
    }
    setValidating(provider);
    setValStatus((prev) => ({ ...prev, [provider]: { ok: false, error: undefined } }));
    try {
      const result = await validateApiKey(provider, key.trim());
      setValStatus((prev) => ({ ...prev, [provider]: result }));
    } catch (err: any) {
      setValStatus((prev) => ({ ...prev, [provider]: { ok: false, error: err.message || '验证失败' } }));
    } finally {
      setValidating(null);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    const settings = { deepseekApiKey: deepseekApiKey.trim(), imageApiKey: imageApiKey.trim() };

    // Validate both keys that are filled in
    const results: Record<string, { ok: boolean; error?: string }> = {};
    if (settings.deepseekApiKey) {
      try { results.deepseek = await validateApiKey('deepseek', settings.deepseekApiKey); }
      catch (e: any) { results.deepseek = { ok: false, error: e.message }; }
    }
    if (settings.imageApiKey) {
      try { results.image2 = await validateApiKey('image2', settings.imageApiKey); }
      catch (e: any) { results.image2 = { ok: false, error: e.message }; }
    }
    setValStatus(results);

    const deepseekOk = !settings.deepseekApiKey || results.deepseek?.ok;
    const imageOk = !settings.imageApiKey || results.image2?.ok;
    if (!deepseekOk || !imageOk) {
      setSaving(false);
      return;
    }

    // Both valid — persist
    saveApiKeySettings(settings);
    try {
      await saveSettings(settings);
      setSaveMsg({ type: 'success', text: '保存成功！API Key 已安全存储。' });
      setTimeout(() => onClose(), 800);
    } catch (err: any) {
      // Saved to localStorage, DB save failed — still usable this session
      setSaveMsg({ type: 'error', text: `保存到本地成功，但同步到服务器失败: ${err.message || '未知错误'}` });
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!window.confirm('确定要清除已保存的两个 API Key 吗？此操作不可恢复。')) return;
    clearApiKeySettings();
    setDeepseekApiKey('');
    setImageApiKey('');
    setValStatus({});
    setSaveMsg(null);
    try { await saveSettings({ deepseekApiKey: '', imageApiKey: '' }); } catch {}
  };

  const deepseekStatus = valStatus['deepseek'];
  const imageStatus = valStatus['image2'];
  const hasAny = !!(deepseekApiKey || imageApiKey);
  const isSaving = saving || validating !== null;

  const KeyInput = ({
    label, provider, value, setValue, visible, setVisible,
    placeholder, description, usageUrl, usageLabel, iconColor, status,
  }: {
    label: string; provider: 'deepseek' | 'image2';
    value: string; setValue: (v: string) => void;
    visible: boolean; setVisible: (v: boolean) => void;
    placeholder: string; description: string;
    usageUrl: string; usageLabel: string;
    iconColor: string; status?: { ok: boolean; error?: string } | undefined;
  }) => (
    <div className="rounded-xl border border-gray-200 bg-gray-50/40 overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-2.5 border-b border-gray-100">
        <div className={`w-8 h-8 rounded-lg ${iconColor} flex items-center justify-center shrink-0`}>
          <KeyRound size={14} className="text-gray-950" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-gray-800">{label}</span>
            <a href={usageUrl} target="_blank" rel="noreferrer"
               className="inline-flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-800 shrink-0">
              {usageLabel} <ExternalLink size={10} />
            </a>
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{description}</p>
        </div>
      </div>
      <div className="px-4 py-3 space-y-2.5">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type={visible ? 'text' : 'password'}
              value={value}
              onChange={(e) => { setValue(e.target.value); if (status) setValStatus((prev) => { const n = {...prev}; delete n[provider]; return n; }); }}
              placeholder={placeholder}
              className="w-full rounded-lg border border-gray-200 bg-[#0a0a14] px-3 py-2 pr-8 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all"
            />
            <button
              type="button"
              onClick={() => setVisible(!visible)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              title={visible ? '隐藏' : '显示'}
            >
              {visible ? <X size={14} /> : <KeyRound size={14} />}
            </button>
          </div>
          <button
            onClick={() => handleValidate(provider)}
            disabled={validating === provider || !value.trim()}
            className="shrink-0 px-3 py-2 text-xs font-medium rounded-lg bg-[#0a0a14] border border-gray-200
                       text-gray-600 hover:bg-gray-100 hover:text-gray-800
                       disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {validating === provider ? (
              <span className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                验证中…
              </span>
            ) : '测试连接'}
          </button>
        </div>
        {validating === provider && (
          <div className="flex items-center gap-2 text-xs text-blue-600 bg-blue-50 rounded-lg px-3 py-2">
            <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            网络请求中，请稍候…
          </div>
        )}
        {status && !validating && (
          <div className={`flex items-start gap-2 text-xs rounded-lg px-3 py-2 ${
            status.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
          }`}>
            {status.ok ? (
              <CheckCircle2 size={14} className="text-emerald-500 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle size={14} className="text-red-400 shrink-0 mt-0.5" />
            )}
            <span className="leading-relaxed">{status.ok ? '连接成功，API Key 有效。' : status.error || '验证失败'}</span>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-2xl border border-gray-200 bg-[#1a1a2e] shadow-2xl shadow-black/40 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-[#1a1a2e] to-[#222244] border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center">
              <KeyRound size={16} className="text-gray-950" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-900">API Key 设置</h2>
              <p className="text-[11px] text-gray-500">配置 AI 服务的访问密钥</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Guidance */}
          <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3">
            <div className="flex items-start gap-2">
              <Info size={16} className="text-blue-500 shrink-0 mt-0.5" />
              <div className="text-xs text-blue-800 leading-relaxed">
                <p className="font-semibold mb-1">如何使用？</p>
                <ol className="list-decimal list-inside space-y-0.5 text-[11px]">
                  <li>点击上方链接注册并获取 API Key</li>
                  <li>将 Key 粘贴到下方输入框</li>
                  <li>点击「测试连接」验证 Key 是否有效</li>
                  <li>验证通过后点击「保存」完成配置</li>
                </ol>
                <p className="mt-2 text-[11px] text-blue-600">配置后 Key 会加密存储在本地，关闭程序后依然有效。</p>
              </div>
            </div>
          </div>

          {/* DeepSeek key */}
          <KeyInput
            label="DeepSeek API Key"
            provider="deepseek"
            value={deepseekApiKey}
            setValue={setDeepseekApiKey}
            visible={deepseekVisible}
            setVisible={setDeepseekVisible}
            placeholder="sk-..."
            description="用于 AI 对话创作、生成小说正文和拆分漫画分镜脚本。"
            usageUrl={DEEPSEEK_USAGE_URL}
            usageLabel="获取 Key / 充值"
            iconColor="bg-blue-600"
            status={deepseekStatus}
          />

          {/* Image2 key */}
          <KeyInput
            label="Image2 API Key"
            provider="image2"
            value={imageApiKey}
            setValue={setImageApiKey}
            visible={imageVisible}
            setVisible={setImageVisible}
            placeholder="填入图片生成 API Key"
            description="用于 AI 生成漫画图片和重新生成单张漫画图片。"
            usageUrl={IMAGE2_CONSOLE_URL}
            usageLabel="获取 Key / 充值"
            iconColor="bg-violet-600"
            status={imageStatus}
          />

          {/* Save message */}
          {saveMsg && (
            <div className={`flex items-start gap-2 text-xs rounded-lg px-3 py-2.5 ${
              saveMsg.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
            }`}>
              {saveMsg.type === 'success'
                ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                : <AlertCircle size={14} className="shrink-0 mt-0.5" />
              }
              <span className="leading-relaxed">{saveMsg.text}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-5 py-4 bg-gray-50/50">
          <button
            onClick={handleClear}
            disabled={!hasAny}
            className="rounded-lg px-3 py-2 text-xs text-gray-500 hover:text-red-600 hover:bg-red-50
                       disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            清除已保存
          </button>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="rounded-lg px-5 py-2 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors">
              取消
            </button>
            <button onClick={handleSave}
              disabled={isSaving}
              className="rounded-lg bg-blue-600 hover:bg-blue-500 px-6 py-2 text-sm font-semibold text-gray-950
                         disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm shadow-blue-600/20
                         flex items-center gap-2"
            >
              {saving ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  验证并保存…
                </>
              ) : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ApiKeyButton({ onClick, compact = false }: { onClick: () => void; compact?: boolean }) {
  const { deepseek, image } = useApiKeyConfigured();
  const status: 'ok' | 'partial' | 'none' =
    deepseek && image ? 'ok' : deepseek || image ? 'partial' : 'none';
  const dotColor =
    status === 'ok' ? 'bg-emerald-400' : status === 'partial' ? 'bg-blue-500' : 'bg-rose-500';
  const tipText =
    status === 'ok'
      ? '已配置 DeepSeek + Image2 API Key'
      : status === 'partial'
      ? `仅配置了 ${deepseek ? 'DeepSeek' : 'Image2'} API Key`
      : '未配置 API Key — 点击设置';
  return (
    <button
      onClick={onClick}
      className="relative inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600 hover:border-blue-600 hover:text-gray-900"
      title={tipText}
    >
      <KeyRound size={14} />
      {!compact && 'API Key'}
      <span
        className={`absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full ring-2 ring-[#1a1a2e] ${dotColor}`}
        aria-hidden
      />
    </button>
  );
}

function App() {
  const isMobile = useIsMobile();
  const [view, setView] = useState<View>('home');
  const [story, setStory] = useState<Story | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [currentIdx, _setCurrentIdx] = useState(0);
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat');
  const [chapterNavOpen, setChapterNavOpen] = useState(true);
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);

  const persistSelectedChapter = (chapter: Chapter | null | undefined) => {
    if (!chapter) return;
    window.location.hash = chapterHash(chapter.chapter_number);
    localStorage.setItem(LS_CHAPTER_ID, String(chapter.id));
    localStorage.removeItem(LS_CHAPTER_IDX);
  };

  const setCurrentIdx = (idx: number | ((prev: number) => number), sourceChapters = chapters) => {
    _setCurrentIdx((prev) => {
      const rawNext = typeof idx === 'function' ? idx(prev) : idx;
      const next = Math.max(0, Math.min(rawNext, sourceChapters.length - 1));
      persistSelectedChapter(sourceChapters[next]);
      return next;
    });
  };

  const selectChapterNumber = (chapterNumber: number, sourceChapters = chapters) => {
    const idx = sourceChapters.findIndex((c) => c.chapter_number === chapterNumber);
    if (idx >= 0) setCurrentIdx(idx, sourceChapters);
  };
  const [loading, setLoading] = useState(true);
  const [creatingChapter, setCreatingChapter] = useState(false);

  // ─── Sync API keys from backend DB on mount ─────────
  useEffect(() => {
    fetchSettings()
      .then((settings) => {
        // Only overwrite localStorage if DB actually has keys.
        // If DB is empty but localStorage has keys (from a previous save),
        // keep the localStorage ones and push them to the DB.
        const local = getApiKeySettings();
        const merged = {
          deepseekApiKey: settings.deepseekApiKey || local.deepseekApiKey,
          imageApiKey: settings.imageApiKey || local.imageApiKey,
        };
        saveApiKeySettings(merged);
        // Push local keys to DB if DB was missing them
        if ((!settings.deepseekApiKey && local.deepseekApiKey) ||
            (!settings.imageApiKey && local.imageApiKey)) {
          saveSettings(merged).catch(() => {});
        }
        if (!merged.deepseekApiKey || !merged.imageApiKey) {
          setApiKeyModalOpen(true);
        }
      })
      .catch(() => {
        // Backend unreachable — rely on localStorage alone
        const local = getApiKeySettings();
        if (!local.deepseekApiKey && !local.imageApiKey) {
          setApiKeyModalOpen(true);
        }
      });
  }, []);

  // ─── Restore session from localStorage on mount ─────────
  useEffect(() => {
    const savedStoryId = localStorage.getItem(LS_STORY_ID);
    if (!savedStoryId) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const stories = await listStories();
        const s = stories.find((x) => x.id === Number(savedStoryId));
        if (!s) {
          localStorage.removeItem(LS_STORY_ID);
          localStorage.removeItem(LS_CHAPTER_ID);
          localStorage.removeItem(LS_CHAPTER_IDX);
          setLoading(false);
          return;
        }
        const chs = await listChapters(s.id);
        const hashChapterNumber = parseChapterNumberHash();
        const savedChapterId = Number(localStorage.getItem(LS_CHAPTER_ID) || '');
        const preferredIdx = hashChapterNumber
          ? chs.findIndex((c) => c.chapter_number === hashChapterNumber)
          : savedChapterId
            ? chs.findIndex((c) => c.id === savedChapterId)
          : -1;
        const idx = preferredIdx >= 0 ? preferredIdx : Math.max(0, chs.length - 1);
        setStory(s);
        setChapters(chs);
        _setCurrentIdx(idx);
        persistSelectedChapter(chs[idx]);
        setView('editor');
      } catch (err) {
        console.error('Failed to restore session:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const currentChapter = chapters[currentIdx] ?? null;

  const enterStory = async (s: Story) => {
    setLoading(true);
    try {
      setStory(s);
      localStorage.setItem(LS_STORY_ID, String(s.id));
      const chs = await listChapters(s.id);
      setChapters(chs);
      setCurrentIdx(Math.max(0, chs.length - 1), chs);
      setView('editor');
    } catch (err) {
      console.error('Failed to load story:', err);
    } finally {
      setLoading(false);
    }
  };

  const goHome = () => {
    setView('home');
    setStory(null);
    setChapters([]);
    _setCurrentIdx(0);
    window.location.hash = '';
    localStorage.removeItem(LS_STORY_ID);
    localStorage.removeItem(LS_CHAPTER_ID);
    localStorage.removeItem(LS_CHAPTER_IDX);
  };

  const refreshCurrentChapter = async () => {
    if (!currentChapter) return;
    const updated = await getChapter(currentChapter.id);
    setChapters((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  };

  const refreshChapter = async (chapterId: number) => {
    try {
      const updated = await getChapter(chapterId);
      setChapters((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } catch {
      // ignore
    }
  };

  const handlePrev = () => {
    if (currentIdx > 0) setCurrentIdx(currentIdx - 1);
  };

  const handleNext = async () => {
    if (creatingChapter) return;
    if (currentIdx < chapters.length - 1) {
      setCurrentIdx(currentIdx + 1);
    } else if (story) {
      setCreatingChapter(true);
      try {
        const newCh = await createNextChapter(story.id);
        const nextChapters = [...chapters, newCh];
        setChapters(nextChapters);
        setCurrentIdx(nextChapters.length - 1, nextChapters);
      } catch (err: any) {
        alert(`创建下一话失败: ${err.message}`);
      } finally {
        setCreatingChapter(false);
      }
    }
  };

  const handleDelete = async () => {
    if (!currentChapter) return;
    if (!confirm(`确定删除第 ${currentChapter.chapter_number} 话？对话和漫画都将被删除。`)) return;
    try {
      await deleteChapter(currentChapter.id);
      const remaining = chapters.filter((c) => c.id !== currentChapter.id);
      if (remaining.length === 0 && story) {
        const newCh = await createNextChapter(story.id);
        setChapters([newCh]);
        setCurrentIdx(0, [newCh]);
      } else {
        setChapters(remaining);
        setCurrentIdx(Math.min(currentIdx, remaining.length - 1), remaining);
      }
    } catch (err: any) {
      alert(`删除失败: ${err.message}`);
    }
  };

  useEffect(() => {
    if (view !== 'editor') return;
    const onHashChange = () => {
      const chapterNumber = parseChapterNumberHash();
      if (chapterNumber) selectChapterNumber(chapterNumber);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [view, chapters]);

  const chapterNav = (
    <aside
      className={`${
        chapterNavOpen ? 'w-64' : 'w-0'
      } hidden md:flex shrink-0 overflow-hidden border-r border-gray-200 bg-[#0f0f1a]/95 backdrop-blur-sm transition-[width] duration-200`}
    >
      <div className="flex w-64 flex-col">
        <div className="flex h-11 items-center justify-between border-b border-gray-200 px-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">目录</span>
          <span className="text-[11px] text-gray-400">{chapters.length} 话</span>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {chapters.map((chapter, idx) => {
            const active = chapter.id === currentChapter?.id;
            return (
              <button
                key={chapter.id}
                onClick={() => setCurrentIdx(idx)}
                className={`mb-1 w-full rounded-lg px-3 py-2 text-left transition-colors ${
                  active
                    ? 'bg-blue-600/20 text-blue-200 border border-blue-700/50'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800 border border-transparent'
                }`}
              >
                <div className="text-xs font-medium">第 {chapter.chapter_number} 话</div>
                <div className="mt-0.5 truncate text-[11px] text-gray-400">
                  {chapter.novel_content ? '已有正文' : chapter.messages.length ? '创作中' : '未开始'}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );

  // ─── Loading ───────────────────────────────────────────
  if (loading) {
    return (
      <div className="h-screen bg-[#0f0f1a] flex items-center justify-center text-gray-600">
        <div className="flex flex-col items-center gap-3">
          <BookOpenText size={40} className="animate-pulse" />
          <span className="text-sm">加载中…</span>
        </div>
      </div>
    );
  }

  // ─── Home page ─────────────────────────────────────────
  if (view === 'home') {
    return (
      <>
        <div className="fixed bottom-4 left-4 z-40">
          <ApiKeyButton onClick={() => setApiKeyModalOpen(true)} />
        </div>
        <HomePage onSelectStory={enterStory} />
        <ApiKeySettingsModal open={apiKeyModalOpen} onClose={() => setApiKeyModalOpen(false)} />
      </>
    );
  }

  // ─── Editor view ───────────────────────────────────────
  return (
    <div className="h-screen flex flex-col bg-[#0f0f1a] text-gray-900">
      {/* Top bar */}
      <header className="h-12 border-b border-gray-200 flex items-center justify-between px-3 md:px-5 shrink-0 bg-[#0f0f1a]/80 backdrop-blur-sm">
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          <button
            onClick={goHome}
            className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-600 hover:text-gray-900
                       hover:bg-gray-100 rounded-lg transition-colors shrink-0"
            title="返回首页"
          >
            <Home size={14} />
            {!isMobile && '首页'}
          </button>
          <div className="w-px h-5 bg-gray-100 shrink-0" />
          <button
            onClick={() => setChapterNavOpen((open) => !open)}
            className="hidden md:flex items-center justify-center w-8 h-8 text-gray-500 hover:text-gray-900
                       hover:bg-gray-100 rounded-lg transition-colors shrink-0"
            title={chapterNavOpen ? '收起目录' : '展开目录'}
            aria-label={chapterNavOpen ? '收起目录' : '展开目录'}
          >
            {chapterNavOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
          <BookOpenText size={16} className="text-blue-500 shrink-0" />
          <span className="text-sm font-semibold tracking-wide truncate max-w-[120px] md:max-w-xs">
            {story?.title ?? '小说漫画生成器'}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500 shrink-0">
          <span>第 {currentChapter?.chapter_number ?? '–'} 话</span>
          {!isMobile && <span>·</span>}
          {!isMobile && <span>共 {chapters.length} 话</span>}
        </div>
      </header>
      <ApiKeySettingsModal open={apiKeyModalOpen} onClose={() => setApiKeyModalOpen(false)} />

      {/* Mobile tab bar */}
      {isMobile && (
        <div className="flex border-b border-gray-200 shrink-0">
          <button
            onClick={() => setMobileTab('chat')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors
              ${mobileTab === 'chat'
                ? 'text-blue-500 border-b-2 border-blue-500 bg-gray-50/50'
                : 'text-gray-500 hover:text-gray-700'}`}
          >
            <MessageSquare size={14} />
            对话
          </button>
          <button
            onClick={() => setMobileTab('manga')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors
              ${mobileTab === 'manga'
                ? 'text-blue-500 border-b-2 border-blue-500 bg-gray-50/50'
                : 'text-gray-500 hover:text-gray-700'}`}
          >
            <Image size={14} />
            漫画
          </button>
        </div>
      )}

      {isMobile && chapters.length > 0 && (
        <div className="flex gap-1 overflow-x-auto border-b border-gray-200 bg-[#0f0f1a] px-2 py-2 shrink-0">
          {chapters.map((chapter, idx) => (
            <button
              key={chapter.id}
              onClick={() => setCurrentIdx(idx)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                chapter.id === currentChapter?.id
                  ? 'border-blue-500 bg-blue-600/20 text-blue-200'
                  : 'border-gray-200 bg-gray-50 text-gray-500 hover:text-gray-700'
              }`}
            >
              第 {chapter.chapter_number} 话
            </button>
          ))}
        </div>
      )}

      {/* Main content */}
      {isMobile ? (
        <main className="flex-1 min-h-0">
          <div className={`h-full ${mobileTab === 'chat' ? '' : 'hidden'}`}>
            <ChatPanel
              chapter={currentChapter}
              onMessageSent={refreshCurrentChapter}
              onChapterRefresh={refreshChapter}
              onGoToManga={() => setMobileTab('manga')}
            />
          </div>
          <div className={`h-full ${mobileTab === 'manga' ? '' : 'hidden'}`}>
            <MangaPanel chapter={currentChapter} onChapterRefresh={refreshChapter} />
          </div>
        </main>
      ) : (
        <main className="flex-1 flex min-h-0">
          {chapterNav}
          <div className="flex flex-1 min-w-0">
            <div className="w-1/2 border-r border-gray-200">
              <ChatPanel chapter={currentChapter} onMessageSent={refreshCurrentChapter} onChapterRefresh={refreshChapter} />
            </div>
            <div className="w-1/2">
              <MangaPanel chapter={currentChapter} onChapterRefresh={refreshChapter} />
            </div>
          </div>
        </main>
      )}

      {/* Bottom navigation */}
      <footer className="h-14 border-t border-gray-200 flex items-center shrink-0 bg-[#0f0f1a]/80 backdrop-blur-sm px-2 md:px-3">
        <div className="flex min-w-0 flex-1 items-center justify-start">
          <ApiKeyButton onClick={() => setApiKeyModalOpen(true)} compact={isMobile} />
        </div>
        <div className="flex shrink-0 items-center justify-center gap-2 md:gap-4">
          <button
            onClick={handlePrev}
            disabled={currentIdx === 0}
            className="flex items-center gap-1 px-3 md:px-5 py-2 text-sm font-medium rounded-lg
                       bg-gray-100 hover:bg-gray-200 text-gray-300 disabled:opacity-30
                       disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={16} />
            {!isMobile && '上一话'}
          </button>

          <button
            onClick={handleDelete}
            disabled={!currentChapter}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg
                       bg-red-900/50 hover:bg-red-800 text-red-300 disabled:opacity-30
                       disabled:cursor-not-allowed transition-colors"
            title="删除当前话"
            aria-label="删除当前话"
          >
            <Trash2 size={14} />
          </button>

          <div className="flex items-center gap-1 text-xs text-gray-400">
            {chapters.map((chapter, i) => (
              <button
                key={chapter.id}
                onClick={() => setCurrentIdx(i)}
                aria-label={`跳转到第 ${chapter.chapter_number} 话`}
                className={`w-2 h-2 rounded-full transition-colors ${
                  i === currentIdx ? 'bg-blue-500' : 'bg-gray-200 hover:bg-gray-600'
                }`}
              />
            ))}
          </div>

          <button
            onClick={handleNext}
            disabled={creatingChapter}
            className="flex items-center gap-1 px-3 md:px-5 py-2 text-sm font-medium rounded-lg
                       bg-blue-600 hover:bg-blue-500 text-gray-950 disabled:opacity-40
                       disabled:cursor-not-allowed transition-colors"
          >
            {currentIdx === chapters.length - 1 ? (
              <>
                <Plus size={16} />
                {creatingChapter ? '新建…' : (isMobile ? '新建' : '下一话（新建）')}
              </>
            ) : (
              <>
                {!isMobile && '下一话'}
                <ChevronRight size={16} />
              </>
            )}
          </button>
        </div>
        <div className="min-w-0 flex-1" aria-hidden />
      </footer>
    </div>
  );
}

export default App;
