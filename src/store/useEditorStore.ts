/**
 * useEditorStore：编辑器全局状态。
 * 管理：文档状态、编辑元素、当前工具、选中项、当前页、缩放、命令栈（撤销/重做）。
 * 所有状态变更（除缩放/选中/工具外）均经 CommandStack 记录，保证可撤销。
 */
import { create } from 'zustand';
import { CommandStack } from '../core/history';
import { clampZoom, pageSizeToPt } from '../core/geometry';
import { uid } from '../core/utils';
import { toastError } from './useUiStore';
import type {
  Command,
  EditorElement,
  PdfDocumentState,
  PdfPageInfo,
  SelectionState,
  TextStyle,
  Tool,
} from '../core/types';

// ---------- 撤销辅助数据（命令 → 被删除元素/被创建元素 id） ----------

const removedElementsMap = new WeakMap<Command, { element: EditorElement; index: number }>();
// 删除页命令：记录被删元素及其在删除前 elements 数组中的原索引（撤销时原位插回，保持 z-order）
const removedPageElementsMap = new WeakMap<Command, { element: EditorElement; index: number }[]>();
const createdElementIdsMap = new WeakMap<Command, string>();

// ---------- 纯函数辅助（可单测） ----------

/** 插入页后：pageIndex >= index 的元素后移一位。 */
export function shiftAfterInsert(elements: EditorElement[], index: number): EditorElement[] {
  return elements.map((e) => (e.pageIndex >= index ? { ...e, pageIndex: e.pageIndex + 1 } : e));
}

/** 删除页后：保留元素与移除元素（pageIndex > index 前移一位）。 */
export function shiftAfterDelete(elements: EditorElement[], index: number): { kept: EditorElement[]; removed: EditorElement[] } {
  const kept: EditorElement[] = [];
  const removed: EditorElement[] = [];
  for (const e of elements) {
    if (e.pageIndex === index) removed.push(e);
    else if (e.pageIndex > index) kept.push({ ...e, pageIndex: e.pageIndex - 1 });
    else kept.push(e);
  }
  return { kept, removed };
}

/** 重排页后：元素的 pageIndex 跟随所在页面迁移。 */
export function remapAfterReorder(elements: EditorElement[], from: number, to: number): EditorElement[] {
  return elements.map((e) => {
    let next: number;
    if (e.pageIndex === from) {
      next = to;
    } else if (from < to) {
      next = e.pageIndex > from && e.pageIndex <= to ? e.pageIndex - 1 : e.pageIndex;
    } else {
      next = e.pageIndex >= to && e.pageIndex < from ? e.pageIndex + 1 : e.pageIndex;
    }
    return next === e.pageIndex ? e : { ...e, pageIndex: next };
  });
}

/** 创建空白页信息（index=-1 表示无原始来源）。 */
export function createBlankPageInfo(widthPt: number, heightPt: number): PdfPageInfo {
  return { index: -1, widthPt, heightPt, rotation: 0 };
}

// ---------- 命令应用 ----------

export function applyCommandToState(
  get: () => EditorState,
  set: (partial: Partial<EditorState> | ((s: EditorState) => Partial<EditorState>)) => void,
  cmd: Command,
  direction: 'do' | 'undo',
): void {
  const s = get();
  const setDoc = (pages: PdfPageInfo[]) =>
    set((st) => (st.doc ? { doc: { ...st.doc, pages, pageCount: pages.length } } : {}));

  switch (cmd.kind) {
    case 'add-element': {
      if (direction === 'do') {
        set({ elements: [...s.elements, cmd.element] });
      } else {
        set({ elements: s.elements.filter((e) => e.id !== cmd.element.id) });
      }
      break;
    }
    case 'remove-element': {
      if (direction === 'do') {
        const el = s.elements.find((e) => e.id === cmd.elementId);
        if (el) removedElementsMap.set(cmd, { element: el, index: s.elements.indexOf(el) });
        set({ elements: s.elements.filter((e) => e.id !== cmd.elementId) });
      } else {
        // 撤销删除：按原索引恢复，保持元素顺序（z-order/绘制顺序）不变
        const entry = removedElementsMap.get(cmd);
        if (entry) {
          const next = [...s.elements];
          next.splice(Math.min(entry.index, next.length), 0, entry.element);
          set({ elements: next });
        }
      }
      break;
    }
    case 'update-element': {
      if (direction === 'do') {
        set({ elements: s.elements.map((e) => (e.id === cmd.elementId ? cmd.after : e)) });
      } else {
        set({ elements: s.elements.map((e) => (e.id === cmd.elementId ? cmd.before : e)) });
      }
      break;
    }
    case 'replace-text': {
      if (direction === 'do') {
        let id = createdElementIdsMap.get(cmd);
        if (!id) {
          id = uid('el');
          createdElementIdsMap.set(cmd, id);
        }
        const el: EditorElement = {
          id,
          type: 'text',
          pageIndex: cmd.pageIndex,
          x: cmd.rect.x,
          y: cmd.rect.y,
          width: cmd.rect.width,
          height: cmd.rect.height,
          text: cmd.newText,
          fontSize: cmd.style.fontSize,
          fontFamily: cmd.style.fontFamily === 'noto' ? 'noto' : cmd.style.fontFamily === 'serif' ? 'serif' : 'sans',
          color: cmd.style.color,
          coversOriginalText: true,
          fillColor: '#ffffff',
          createdAt: Date.now(),
        };
        const rest = s.elements.filter((e) => e.id !== id);
        set({ elements: [...rest, el] });
      } else {
        const id = createdElementIdsMap.get(cmd);
        if (id) set({ elements: s.elements.filter((e) => e.id !== id) });
      }
      break;
    }
    case 'page-insert': {
      if (direction === 'do') {
        const pages = [...(s.doc?.pages ?? [])];
        pages.splice(cmd.index, 0, cmd.page);
        set({ elements: shiftAfterInsert(s.elements, cmd.index) });
        setDoc(pages);
      } else {
        const pages = [...(s.doc?.pages ?? [])];
        pages.splice(cmd.index, 1);
        const { kept } = shiftAfterDelete(s.elements, cmd.index);
        set({ elements: kept });
        setDoc(pages);
      }
      break;
    }
    case 'page-delete': {
      if (direction === 'do') {
        const pages = [...(s.doc?.pages ?? [])];
        pages.splice(cmd.index, 1);
        const { kept, removed } = shiftAfterDelete(s.elements, cmd.index);
        if (removed.length) {
          // 记录每个被删元素在删除前数组中的原索引，供撤销原位恢复（保持 z-order）
          const entries = removed.map((element) => ({ element, index: s.elements.indexOf(element) }));
          removedPageElementsMap.set(cmd, entries);
        }
        set({ elements: kept });
        setDoc(pages);
      } else {
        const pages = [...(s.doc?.pages ?? [])];
        pages.splice(cmd.index, 0, cmd.page);
        // 先迁移保留元素（pageIndex >= index 后移一位），再按原索引原位插回被删元素
        const next = shiftAfterInsert(s.elements, cmd.index);
        const entries = removedPageElementsMap.get(cmd) ?? [];
        const sorted = [...entries].sort((a, b) => a.index - b.index);
        for (const entry of sorted) {
          next.splice(Math.min(entry.index, next.length), 0, entry.element);
        }
        set({ elements: next });
        setDoc(pages);
      }
      break;
    }
    case 'page-reorder': {
      // 撤销 = 反向移动（to → from）
      const f = direction === 'do' ? cmd.fromIndex : cmd.toIndex;
      const t = direction === 'do' ? cmd.toIndex : cmd.fromIndex;
      const pages = [...(s.doc?.pages ?? [])];
      const [moved] = pages.splice(f, 1);
      pages.splice(t, 0, moved);
      set({ elements: remapAfterReorder(s.elements, f, t) });
      setDoc(pages);
      break;
    }
    default:
      break;
  }
}

// ---------- Store ----------

export interface EditorState {
  doc: PdfDocumentState | null;
  elements: EditorElement[];
  tool: Tool;
  selection: SelectionState;
  currentPage: number;
  zoom: number;
  stack: CommandStack;
  setDoc: (doc: PdfDocumentState) => void;
  setThumbnail: (index: number, url: string) => void;
  reset: () => void;
  setTool: (tool: Tool) => void;
  setCurrentPage: (index: number) => void;
  setZoom: (zoom: number) => void;
  select: (elementId: string | null, pageIndex: number | null) => void;
  addElement: (el: EditorElement) => void;
  updateElement: (id: string, patch: Partial<EditorElement>) => void;
  moveElement: (id: string, dx: number, dy: number) => void;
  removeElement: (id: string) => void;
  replaceText: (pageIndex: number, rect: { x: number; y: number; width: number; height: number }, oldText: string, newText: string, style: TextStyle) => void;
  insertBlankPage: (index?: number) => void;
  deletePage: (index: number) => boolean;
  reorderPages: (from: number, to: number) => void;
  undo: () => void;
  redo: () => void;
}

export const useEditorStore = create<EditorState>((set, get) => {
  const stack = new CommandStack((cmd, dir) => applyCommandToState(get, set, cmd, dir));

  const setDoc = (doc: PdfDocumentState): void => {
    stack.clear();
    set({
      doc,
      elements: [],
      selection: { elementId: null, pageIndex: null },
      currentPage: 0,
      zoom: 1,
    });
  };

  return {
    doc: null,
    elements: [],
    tool: 'select',
    selection: { elementId: null, pageIndex: null },
    currentPage: 0,
    zoom: 1,
    stack,

    setDoc,
    setThumbnail: (index: number, url: string) =>
      set((s) => {
        if (!s.doc || !s.doc.pages[index]) return {};
        const pages = s.doc.pages.map((p, i) => (i === index ? { ...p, thumbnailUrl: url } : p));
        return { doc: { ...s.doc, pages } };
      }),

    reset: () => {
      stack.clear();
      set({
        doc: null,
        elements: [],
        tool: 'select',
        selection: { elementId: null, pageIndex: null },
        currentPage: 0,
        zoom: 1,
      });
    },

    setTool: (tool: Tool) => set({ tool, selection: { elementId: null, pageIndex: null } }),
    setCurrentPage: (index: number) =>
      set((s) => {
        const max = (s.doc?.pages.length ?? 1) - 1;
        return { currentPage: Math.max(0, Math.min(index, max)) };
      }),
    setZoom: (zoom: number) => set({ zoom: clampZoom(zoom) }),

    select: (elementId: string | null, pageIndex: number | null) =>
      set({ selection: { elementId, pageIndex } }),

    addElement: (el: EditorElement) => {
      stack.push({ kind: 'add-element', element: el });
      set({ selection: { elementId: el.id, pageIndex: el.pageIndex } });
    },

    updateElement: (id: string, patch: Partial<EditorElement>) => {
      const before = get().elements.find((e) => e.id === id);
      if (!before) return;
      const after = { ...before, ...patch };
      stack.push({ kind: 'update-element', elementId: id, before, after });
    },

    moveElement: (id: string, dx: number, dy: number) => {
      const el = get().elements.find((e) => e.id === id);
      if (!el) return;
      get().updateElement(id, { x: el.x + dx, y: el.y + dy });
    },

    removeElement: (id: string) => {
      const el = get().elements.find((e) => e.id === id);
      if (!el) return;
      stack.push({ kind: 'remove-element', elementId: id, pageIndex: el.pageIndex });
      set({ selection: { elementId: null, pageIndex: null } });
    },

    replaceText: (pageIndex, rect, oldText, newText, style) => {
      stack.push({ kind: 'replace-text', pageIndex, rect, oldText, newText, style });
    },

    insertBlankPage: (index?: number) => {
      const s = get();
      if (!s.doc) return;
      const ref = s.doc.pages[s.currentPage] ?? s.doc.pages[0];
      const w = ref?.widthPt ?? pageSizeToPt('a4').width;
      const h = ref?.heightPt ?? pageSizeToPt('a4').height;
      const at = index ?? Math.min(s.currentPage + 1, s.doc.pages.length);
      stack.push({ kind: 'page-insert', index: at, page: createBlankPageInfo(w, h) });
      set({ currentPage: at });
    },

    deletePage: (index: number): boolean => {
      const s = get();
      if (!s.doc || s.doc.pages.length <= 1) {
        toastError('至少需要保留一页');
        return false;
      }
      const page = s.doc.pages[index];
      if (!page) return false;
      stack.push({ kind: 'page-delete', index, page });
      const next = Math.max(0, Math.min(index, s.doc.pages.length - 2));
      set({ currentPage: next, selection: { elementId: null, pageIndex: null } });
      return true;
    },

    reorderPages: (from: number, to: number) => {
      const s = get();
      if (!s.doc || from === to) return;
      const max = s.doc.pages.length - 1;
      if (from < 0 || from > max || to < 0 || to > max) return;
      stack.push({ kind: 'page-reorder', fromIndex: from, toIndex: to });
      set({ currentPage: to, selection: { elementId: null, pageIndex: null } });
    },

    undo: () => stack.undo(),
    redo: () => stack.redo(),
  };
});
