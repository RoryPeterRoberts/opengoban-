/**
 * Cell Protocol - Result Type
 *
 * A discriminated union type for representing success or failure,
 * enabling explicit error handling without exceptions.
 */

// ============================================
// RESULT TYPE
// ============================================

/** Successful result */
export interface Ok<T> {
  ok: true;
  value: T;
}

/** Failed result */
export interface Err<E> {
  ok: false;
  error: E;
}

/** Discriminated union of success or failure */
export type Result<T, E> = Ok<T> | Err<E>;

// ============================================
// CONSTRUCTORS
// ============================================

/** Create a successful result */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/** Create a failed result */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

// ============================================
// TYPE GUARDS
// ============================================

/** Check if result is successful */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok === true;
}

/** Check if result is an error */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return result.ok === false;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/** Unwrap a result, throwing if error */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) {
    return result.value;
  }
  throw new Error(`Unwrap called on error result: ${JSON.stringify(result.error)}`);
}

/** Unwrap a result with a default value */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  if (result.ok) {
    return result.value;
  }
  return defaultValue;
}

/** Map over a successful result */
export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  if (result.ok) {
    return ok(fn(result.value));
  }
  return result;
}

/** Map over an error result */
export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  if (result.ok) {
    return result;
  }
  return err(fn(result.error));
}

/** Chain results (flatMap) */
export function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> {
  if (result.ok) {
    return fn(result.value);
  }
  return result;
}

/** Combine multiple results into one */
export function all<T, E>(results: Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) {
      return result;
    }
    values.push(result.value);
  }
  return ok(values);
}

/** Try to execute a function, catching any thrown errors */
export function tryCatch<T, E = Error>(
  fn: () => T,
  errorMapper: (e: unknown) => E = (e) => e as E
): Result<T, E> {
  try {
    return ok(fn());
  } catch (e) {
    return err(errorMapper(e));
  }
}

/** Async version of tryCatch */
export async function tryCatchAsync<T, E = Error>(
  fn: () => Promise<T>,
  errorMapper: (e: unknown) => E = (e) => e as E
): Promise<Result<T, E>> {
  try {
    return ok(await fn());
  } catch (e) {
    return err(errorMapper(e));
  }
}
