export class DocumentError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields: string[] = [],
  ) {
    super(message);
    this.name = "DocumentError";
  }
}
