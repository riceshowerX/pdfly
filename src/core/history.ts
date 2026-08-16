/**
 * CommandStack：撤销/重做命令栈（≥20 步，默认上限 100）。
 *
 * 设计说明：
 * - push(cmd) 会立即通过 onApply(cmd, 'do') 应用命令，同时截断 redo 分支；
 * - undo() 通过 onApply(cmd, 'undo') 回退当前栈顶命令，redo() 重新应用；
 * - onApply 由调用方（zustand store）注入，负责把命令落到实际状态上。
 *
 * 该实现是纯类，不依赖 DOM，可直接单测。
 */
import type { Command } from './types';

export interface CommandApplyFn {
  (cmd: Command, direction: 'do' | 'undo'): void;
}

export class CommandStack {
  private readonly stack: Command[] = [];
  private index = -1;
  private readonly limit: number;
  private readonly onApply: CommandApplyFn;

  constructor(onApply: CommandApplyFn, limit = 100) {
    this.onApply = onApply;
    this.limit = Math.max(20, limit);
  }

  get canUndo(): boolean {
    return this.index >= 0;
  }

  get canRedo(): boolean {
    return this.index < this.stack.length - 1;
  }

  get size(): number {
    return this.stack.length;
  }

  get cursor(): number {
    return this.index;
  }

  /** 压入新命令并立即应用（do）。 */
  push(cmd: Command): void {
    // 截断 redo 分支
    if (this.index < this.stack.length - 1) {
      this.stack.splice(this.index + 1);
    }
    // 先应用命令，成功后再入栈；应用失败（抛错）时不记录该命令，保持状态与索引一致
    this.onApply(cmd, 'do');
    this.stack.push(cmd);
    if (this.stack.length > this.limit) {
      this.stack.shift();
    }
    this.index = this.stack.length - 1;
  }

  /** 撤销最近一次操作。 */
  undo(): void {
    if (!this.canUndo) return;
    const cmd = this.stack[this.index];
    // 先应用成功再移动 index；onApply 抛错时 index 不移动，避免状态与索引不一致
    this.onApply(cmd, 'undo');
    this.index -= 1;
  }

  /** 重做最近一次撤销。 */
  redo(): void {
    if (!this.canRedo) return;
    this.index += 1;
    const cmd = this.stack[this.index];
    try {
      this.onApply(cmd, 'do');
    } catch (err) {
      // 应用失败回滚 index，保证后续撤销/重做语义不紊乱
      this.index -= 1;
      throw err;
    }
  }

  /** 清空历史。 */
  clear(): void {
    this.stack.length = 0;
    this.index = -1;
  }
}
