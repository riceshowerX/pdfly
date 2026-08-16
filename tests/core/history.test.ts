/**
 * CommandStack 单测：push/undo/redo、redo 分支截断、步数上限（≥20）、clear。
 */
import { describe, expect, it, vi } from 'vitest';
import { CommandStack } from '../../src/core/history';
import type { Command } from '../../src/core/types';

function makeCmd(id: string): Command {
  return {
    kind: 'add-element',
    element: { id, type: 'text', pageIndex: 0, x: 0, y: 0, width: 10, height: 10, text: id, createdAt: 0 },
  };
}

describe('CommandStack', () => {
  it('push 立即应用命令（do）', () => {
    const apply = vi.fn();
    const stack = new CommandStack(apply);
    stack.push(makeCmd('a'));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ kind: 'add-element' }), 'do');
    expect(stack.canUndo).toBe(true);
    expect(stack.canRedo).toBe(false);
  });

  it('undo/redo 按序回退与重放', () => {
    const applied: string[] = [];
    const stack = new CommandStack((cmd, dir) => {
      const c = cmd as { element?: { id?: string } };
      applied.push(`${dir}:${c.element?.id ?? '?'}`);
    });
    stack.push(makeCmd('a'));
    stack.push(makeCmd('b'));
    expect(applied).toEqual(['do:a', 'do:b']);

    stack.undo();
    expect(applied).toEqual(['do:a', 'do:b', 'undo:b']);
    expect(stack.canUndo).toBe(true);
    expect(stack.canRedo).toBe(true);

    stack.undo();
    expect(applied.at(-1)).toBe('undo:a');
    expect(stack.canUndo).toBe(false);

    stack.redo();
    expect(applied.at(-1)).toBe('do:a');
    stack.redo();
    expect(applied.at(-1)).toBe('do:b');
    expect(stack.canRedo).toBe(false);
  });

  it('push 截断 redo 分支', () => {
    const applied: string[] = [];
    const stack = new CommandStack((cmd, dir) => {
      const c = cmd as { element?: { id?: string } };
      applied.push(`${dir}:${c.element?.id ?? '?'}`);
    });
    stack.push(makeCmd('a'));
    stack.push(makeCmd('b'));
    stack.undo();
    stack.push(makeCmd('c'));
    expect(applied).toEqual(['do:a', 'do:b', 'undo:b', 'do:c']);
    expect(stack.canRedo).toBe(false);
    expect(stack.size).toBe(2);
  });

  it('空栈 undo/redo 安全无操作', () => {
    const apply = vi.fn();
    const stack = new CommandStack(apply);
    stack.undo();
    stack.redo();
    expect(apply).not.toHaveBeenCalled();
  });

  it('步数上限：超出 limit 后丢弃最旧命令', () => {
    const apply = vi.fn();
    const stack = new CommandStack(apply, 20);
    for (let i = 0; i < 30; i += 1) stack.push(makeCmd(`c${i}`));
    expect(stack.size).toBe(20);
    expect(stack.cursor).toBe(19);
    // 产品预期（PRD AC-E6 / limit=20）：保留最近 20 条，可撤销 20 次，撤销耗尽后 canUndo=false
    let n = 0;
    while (stack.canUndo) {
      stack.undo();
      n += 1;
    }
    expect(n).toBe(20);
    expect(stack.canUndo).toBe(false);
    // 撤销耗尽后可重做恢复全部 20 步
    let m = 0;
    while (stack.canRedo) {
      stack.redo();
      m += 1;
    }
    expect(m).toBe(20);
    expect(stack.canRedo).toBe(false);
  });

  it('clear 清空历史', () => {
    const stack = new CommandStack(vi.fn());
    stack.push(makeCmd('a'));
    stack.clear();
    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(false);
    expect(stack.size).toBe(0);
  });

  it('C4：onApply 抛错时索引保持一致（异常回滚）', () => {
    const stack = new CommandStack((cmd, dir) => {
      if (dir === 'undo') throw new Error('apply failed');
      void cmd;
    });
    stack.push(makeCmd('a'));
    expect(stack.canUndo).toBe(true);
    // 撤销应用失败：index 不移动，canUndo 仍为 true，可重试
    expect(() => stack.undo()).toThrow('apply failed');
    expect(stack.canUndo).toBe(true);
    expect(stack.cursor).toBe(0);
    // push 应用失败：命令不入栈，栈状态一致
    const stack2 = new CommandStack(() => {
      throw new Error('push failed');
    });
    expect(() => stack2.push(makeCmd('b'))).toThrow('push failed');
    expect(stack2.size).toBe(0);
    expect(stack2.canUndo).toBe(false);
  });
});
