/** Only for idempotent authorization reads; never replay an uncertain business write. */
export function createReadRecovery(resetPool: () => Promise<void>) {
  let resetting: Promise<void> | undefined;
  return async function readWithRecovery<T>(read: () => Promise<T>): Promise<T> {
    try { return await read(); }
    catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code !== "P1001" && code !== "P1017") throw error;
      resetting ??= Promise.resolve().then(resetPool).finally(() => { resetting = undefined; });
      await resetting;
      return read();
    }
  };
}
