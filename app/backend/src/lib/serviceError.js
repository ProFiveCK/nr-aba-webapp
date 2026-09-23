/**
 * A failure a caller is meant to see, as opposed to one that means the server
 * is broken.
 *
 * Services throw these instead of writing responses, so the business rules do
 * not need to know an HTTP response exists. The global error handler reads
 * `status` and passes the message through; anything else that reaches it is
 * treated as a server fault and its message is withheld.
 */
export class ServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ServiceError';
    this.status = status;
  }
}

/** The request asked for something that cannot be done. */
export const badRequest = (message) => new ServiceError(400, message);
/** The caller is not allowed to do this to this record. */
export const forbidden = (message) => new ServiceError(403, message);
/** No such record, or none the caller may see. */
export const notFound = (message) => new ServiceError(404, message);
