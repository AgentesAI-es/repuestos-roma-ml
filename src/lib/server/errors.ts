/** Un error con su status HTTP y un código estable, para responder al framework o al panel. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string,
  ) {
    super(message);
  }
}
