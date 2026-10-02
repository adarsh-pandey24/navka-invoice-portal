/**
 * Hard assertion for the test scripts.
 * The original scripts used console.assert(), which only prints a message and
 * lets the run continue, so a failing check still ended in "PASSED".
 */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}
