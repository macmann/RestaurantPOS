export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}. Expected ${String(expected)}, received ${String(actual)}.`);
}

export async function assertRejects(action: () => Promise<unknown>, expectedMessage: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    assert(String(error).includes(expectedMessage), `Expected rejection containing "${expectedMessage}".`);
    return;
  }
  throw new Error(`Expected rejection containing "${expectedMessage}".`);
}
