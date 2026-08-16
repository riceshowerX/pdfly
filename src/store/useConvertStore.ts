/**
 * useConvertStore：转换任务状态（进度/结果/取消）。
 */
import { create } from 'zustand';
import { uid } from '../core/utils';
import type { ConvertResult, ConvertTask, TaskStatus } from '../core/types';

interface ConvertState {
  tasks: Record<string, ConvertTask>;
  startTask: (task: Partial<ConvertTask> & { kind: ConvertTask['kind']; total: number }) => string;
  updateProgress: (id: string, done: number, failed: number) => void;
  addResult: (id: string, result: ConvertResult) => void;
  setStatus: (id: string, status: TaskStatus, error?: string) => void;
  setOutputName: (id: string, name: string) => void;
  cancelTask: (id: string) => void;
  removeTask: (id: string) => void;
}

export const useConvertStore = create<ConvertState>((set) => ({
  tasks: {},

  startTask: (task) => {
    const id = task.id ?? uid('task');
    const newTask: ConvertTask = {
      id,
      kind: task.kind,
      status: 'running',
      total: task.total,
      done: 0,
      failed: 0,
      cancelRequested: false,
      results: [],
      outputName: task.outputName,
    };
    set((s) => ({ tasks: { ...s.tasks, [id]: newTask } }));
    return id;
  },

  updateProgress: (id, done, failed) =>
    set((s) => {
      const t = s.tasks[id];
      if (!t) return {};
      return { tasks: { ...s.tasks, [id]: { ...t, done, failed } } };
    }),

  addResult: (id, result) =>
    set((s) => {
      const t = s.tasks[id];
      if (!t) return {};
      return { tasks: { ...s.tasks, [id]: { ...t, results: [...t.results, result] } } };
    }),

  setStatus: (id, status, error) =>
    set((s) => {
      const t = s.tasks[id];
      if (!t) return {};
      return { tasks: { ...s.tasks, [id]: { ...t, status, error } } };
    }),

  setOutputName: (id, name) =>
    set((s) => {
      const t = s.tasks[id];
      if (!t) return {};
      return { tasks: { ...s.tasks, [id]: { ...t, outputName: name } } };
    }),

  cancelTask: (id) =>
    set((s) => {
      const t = s.tasks[id];
      if (!t) return {};
      return { tasks: { ...s.tasks, [id]: { ...t, cancelRequested: true } } };
    }),

  removeTask: (id) =>
    set((s) => {
      const next = { ...s.tasks };
      delete next[id];
      return { tasks: next };
    }),
}));
