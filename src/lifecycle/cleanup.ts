export class CleanupManager {
  private readonly tasks: Array<() => Promise<void> | void> = [];
  private running: Promise<void> | null = null;

  add(task: () => Promise<void> | void): void {
    this.tasks.push(task);
  }

  runAll(): Promise<void> {
    if (this.running === null) {
      this.running = (async () => {
        for (const task of this.tasks.reverse()) {
          try {
            await task();
          } catch {
            // cleanup must never throw
          }
        }
      })();
    }
    return this.running;
  }
}
