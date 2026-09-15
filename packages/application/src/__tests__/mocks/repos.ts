import { type Mock, vi } from "vitest";
import type { ITodoRepository } from "@monorepo-template/domain/repositories";

/** An `ITodoRepository` whose every method is a `vi.fn()`, ready to stub per test. */
export type MockTodoRepo = { [K in keyof ITodoRepository]: Mock };

export function mockTodoRepo(): MockTodoRepo {
  return {
    findById: vi.fn(),
    findAllByUserId: vi.fn(),
    findAllByUserIdPaginated: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}
