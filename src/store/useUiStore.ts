/**
 * useUiStore：全局 UI 状态（Toast / Modal / 应用设置）。
 */
import { create } from 'zustand';
import { uid } from '../core/utils';
import type { AppSettings, ModalState, Toast, ToastKind } from '../core/types';

interface UiState {
  toasts: Toast[];
  modal: ModalState | null;
  settings: AppSettings;
  pushToast: (kind: ToastKind, message: string, duration?: number) => void;
  dismissToast: (id: string) => void;
  openModal: (modal: ModalState) => void;
  closeModal: () => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
}

const DEFAULT_SETTINGS: AppSettings = {
  compactThumbnails: false,
  confirmBeforeDelete: true,
};

export const useUiStore = create<UiState>((set, get) => ({
  toasts: [],
  modal: null,
  settings: DEFAULT_SETTINGS,

  pushToast: (kind: ToastKind, message: string, duration = 3200) => {
    const id = uid('toast');
    set((s) => ({ toasts: [...s.toasts, { id, kind, message, duration }] }));
    window.setTimeout(() => {
      get().dismissToast(id);
    }, duration);
  },

  dismissToast: (id: string) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  openModal: (modal: ModalState) => set({ modal }),
  closeModal: () => set({ modal: null }),

  updateSettings: (patch: Partial<AppSettings>) =>
    set((s) => ({ settings: { ...s.settings, ...patch } })),
}));

/** 便捷方法：成功提示。 */
export function toastSuccess(message: string): void {
  useUiStore.getState().pushToast('success', message);
}

export function toastError(message: string): void {
  useUiStore.getState().pushToast('error', message);
}

export function toastInfo(message: string): void {
  useUiStore.getState().pushToast('info', message);
}

export function toastWarning(message: string): void {
  useUiStore.getState().pushToast('warning', message);
}

export function getToastIcon(kind: ToastKind): string {
  switch (kind) {
    case 'success':
      return '✓';
    case 'error':
      return '✕';
    case 'warning':
      return '!';
    default:
      return 'i';
  }
}
